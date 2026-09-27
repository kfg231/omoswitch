use crate::error::AppError;
use serde_json::{Map, Value};

#[derive(Clone, Debug)]
struct Member {
    key: String,
    value_start: usize,
    value_end: usize,
}

#[derive(Clone, Debug)]
struct Object {
    end: usize,
    members: Vec<Member>,
}

fn malformed(text: &str, at: usize, detail: impl Into<String>) -> AppError {
    let prefix = &text[..at.min(text.len())];
    AppError::MalformedJsonc {
        message: detail.into(),
        line: prefix.bytes().filter(|b| *b == b'\n').count() + 1,
        col: prefix
            .rsplit('\n')
            .next()
            .map_or(1, |s| s.chars().count() + 1),
    }
}

fn skip(text: &str, mut p: usize) -> Result<usize, AppError> {
    loop {
        while let Some(b) = text.as_bytes().get(p) {
            if b.is_ascii_whitespace() {
                p += 1;
            } else {
                break;
            }
        }
        if p >= text.len() {
            return Ok(p);
        }
        if p < text.len() && text[p..].starts_with("//") {
            p += 2;
            while text.as_bytes().get(p).is_some_and(|b| *b != b'\n') {
                p += 1;
            }
            if p >= text.len() {
                return Ok(p);
            }
            continue;
        }
        if p + 1 < text.len() && text[p..].starts_with("/*") {
            let Some(end) = text[p + 2..].find("*/") else {
                return Err(malformed(text, p, "unterminated comment"));
            };
            p += end + 4;
            continue;
        }
        return Ok(p);
    }
}

fn string_end(text: &str, mut p: usize) -> Result<usize, AppError> {
    let quote = text.as_bytes()[p];
    p += 1;
    while p < text.len() {
        match text.as_bytes()[p] {
            b'\\' => p += 2,
            b if b == quote => return Ok(p + 1),
            _ => p += 1,
        }
    }
    Err(malformed(text, p.saturating_sub(1), "unterminated string"))
}

fn value_end(text: &str, start: usize) -> Result<usize, AppError> {
    let mut p = skip(text, start)?;
    if p >= text.len() {
        return Err(malformed(text, p, "missing value"));
    }
    if matches!(text.as_bytes()[p], b'"' | b'\'') {
        return string_end(text, p);
    }
    if matches!(text.as_bytes()[p], b'{' | b'[') {
        let open = text.as_bytes()[p];
        let close = if open == b'{' { b'}' } else { b']' };
        p += 1;
        let mut stack = vec![close];
        let mut steps = 0usize;
        while p < text.len() && !stack.is_empty() {
            steps += 1;
            if steps > text.len().saturating_mul(2) {
                return Err(malformed(text, p, "value scan made no progress"));
            }
            p = skip(text, p)?;
            if p >= text.len() {
                break;
            }
            match text.as_bytes()[p] {
                b'"' | b'\'' => p = string_end(text, p)?,
                b'{' => {
                    stack.push(b'}');
                    p += 1;
                }
                b'[' => {
                    stack.push(b']');
                    p += 1;
                }
                b'}' | b']' => {
                    if stack.last() != Some(&text.as_bytes()[p]) {
                        return Err(malformed(text, p, "mismatched delimiter"));
                    }
                    stack.pop();
                    p += 1;
                }
                _ => p += 1,
            }
        }
        if !stack.is_empty() {
            return Err(malformed(text, p, "unterminated value"));
        }
        return Ok(p);
    }
    while p < text.len() && !matches!(text.as_bytes()[p], b',' | b'}' | b']') {
        p += 1;
    }
    Ok(p)
}

fn key_at(text: &str, p: usize) -> Result<(String, usize), AppError> {
    if matches!(text.as_bytes()[p], b'"' | b'\'') {
        let end = string_end(text, p)?;
        let key = if text.as_bytes()[p] == b'"' {
            serde_json::from_str(&text[p..end]).map_err(|e| malformed(text, p, e.to_string()))?
        } else {
            text[p + 1..end - 1]
                .replace("\\'", "'")
                .replace("\\\\", "\\")
        };
        return Ok((key, end));
    }
    let mut end = p;
    while end < text.len() && !matches!(text.as_bytes()[end], b':' | b' ' | b'\t' | b'\r' | b'\n') {
        end += 1;
    }
    Ok((text[p..end].to_owned(), end))
}

fn object_at(text: &str, start: usize) -> Result<Object, AppError> {
    if text.as_bytes().get(start) != Some(&b'{') {
        return Err(malformed(text, start, "expected object"));
    }
    let mut p = start + 1;
    let mut members = Vec::new();
    let mut steps = 0usize;
    loop {
        steps += 1;
        if steps > text.len().saturating_mul(2) {
            return Err(malformed(
                text,
                p,
                format!("object scan made no progress at byte {p}"),
            ));
        }
        p = skip(text, p)?;
        if p >= text.len() {
            return Err(malformed(text, p, "unterminated object"));
        }
        if text.as_bytes()[p] == b'}' {
            return Ok(Object {
                end: p + 1,
                members,
            });
        }
        let (key, key_end) = key_at(text, p)?;
        p = key_end;
        p = skip(text, p)?;
        if text.as_bytes().get(p) != Some(&b':') {
            return Err(malformed(text, p, "expected ':'"));
        }
        let value_start = skip(text, p + 1)?;
        let value_end = value_end(text, value_start)?;
        members.push(Member {
            key,
            value_start,
            value_end,
        });
        p = skip(text, value_end)?;
        if text.as_bytes().get(p) == Some(&b',') {
            p += 1;
            continue;
        }
        if text.as_bytes().get(p) == Some(&b'}') {
            return Ok(Object {
                end: p + 1,
                members,
            });
        }
        return Err(malformed(text, p, "expected ',' or '}'"));
    }
}

fn root_and_native(text: &str) -> Result<(Value, Object, Option<Object>), AppError> {
    let root_start = skip(text, 0)?;
    let root = object_at(text, root_start)?;
    let value = parse_value(text)?;
    let natives: Vec<&Member> = root
        .members
        .iter()
        .filter(|m| m.key == "[native]")
        .collect();
    if natives.len() > 1 {
        return Err(AppError::DuplicateKey {
            key: "[native]".into(),
            message: "duplicate top-level key".into(),
        });
    }
    let native = natives
        .first()
        .map(|m| object_at(text, m.value_start))
        .transpose()?;
    if let Some(obj) = &native {
        for key in ["agents", "categories"] {
            if obj.members.iter().filter(|m| m.key == key).count() > 1 {
                return Err(AppError::DuplicateKey {
                    key: key.into(),
                    message: "duplicate key in [native]".into(),
                });
            }
        }
    }
    Ok((value, root, native))
}

pub fn parse_value(text: &str) -> Result<Value, AppError> {
    json5::from_str(text).map_err(|error| {
        let (line, col) = match error {
            json5::Error::Message {
                location: Some(ref location),
                ..
            } => (location.line, location.column),
            json5::Error::Message { location: None, .. } => (1, 1),
        };
        AppError::MalformedJsonc {
            message: error.to_string(),
            line,
            col,
        }
    })
}

pub fn has_key(text: &str, top_key: &str) -> Result<bool, AppError> {
    let (_, root, _) = root_and_native(text)?;
    Ok(root.members.iter().any(|m| m.key == top_key))
}

pub fn native_subtrees(text: &str) -> Result<(Map<String, Value>, Map<String, Value>), AppError> {
    let (value, _, _) = root_and_native(text)?;
    let Some(native) = value.get("[native]") else {
        return Ok((Map::new(), Map::new()));
    };
    let Some(obj) = native.as_object() else {
        return Err(AppError::NotAnObject {
            message: "[native] must be an object".into(),
        });
    };
    let get = |key: &str| -> Result<Map<String, Value>, AppError> {
        match obj.get(key) {
            None => Ok(Map::new()),
            Some(Value::Object(map)) => Ok(map.clone()),
            Some(_) => Err(AppError::NotAnObject {
                message: format!("[native].{key} must be an object"),
            }),
        }
    };
    Ok((get("agents")?, get("categories")?))
}

fn pretty(value: &Map<String, Value>, newline: &str) -> String {
    serde_json::to_string_pretty(&Value::Object(value.clone()))
        .unwrap_or_else(|_| "{}".into())
        .replace('\n', newline)
}

fn line_indent(text: &str, at: usize) -> String {
    let line_start = text[..at].rfind('\n').map_or(0, |index| index + 1);
    text[line_start..at]
        .chars()
        .take_while(|character| *character == ' ' || *character == '\t')
        .collect()
}

fn indent_unit(text: &str, root: &Object) -> String {
    root.members.first().map_or_else(
        || "  ".into(),
        |member| line_indent(text, member.value_start),
    )
}

fn reindent(value: &Map<String, Value>, newline: &str, unit: &str, base: &str) -> String {
    pretty(value, newline)
        .split(newline)
        .enumerate()
        .map(|(line, content)| {
            if line == 0 {
                content.to_owned()
            } else {
                let level = content.bytes().take_while(|byte| *byte == b' ').count() / 2;
                format!("{}{}", base, unit.repeat(level) + content.trim_start())
            }
        })
        .collect::<Vec<_>>()
        .join(newline)
}

fn has_comma_after(text: &str, at: usize) -> bool {
    skip(text, at).is_ok_and(|position| text.as_bytes().get(position) == Some(&b','))
}

fn native_member(
    agents: &Map<String, Value>,
    categories: &Map<String, Value>,
    newline: &str,
    unit: &str,
    member_indent: &str,
) -> String {
    let child_indent = format!("{member_indent}{unit}");
    let agents_text = reindent(agents, newline, unit, &child_indent);
    let categories_text = reindent(categories, newline, unit, &child_indent);
    format!(
        "\"[native]\": {{{newline}{child_indent}\"agents\": {agents_text},{newline}{child_indent}\"categories\": {categories_text}{newline}{member_indent}}}"
    )
}

pub fn set_native_subtrees(
    text: &str,
    agents: &Map<String, Value>,
    categories: &Map<String, Value>,
) -> Result<String, AppError> {
    let (mut expected, root, native) = root_and_native(text)?;
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let unit = indent_unit(text, &root);
    let root_obj = expected
        .as_object_mut()
        .ok_or_else(|| AppError::NotAnObject {
            message: "root must be an object".into(),
        })?;
    let native_value = root_obj
        .entry("[native]")
        .or_insert_with(|| Value::Object(Map::new()));
    let native_obj = native_value
        .as_object_mut()
        .ok_or_else(|| AppError::NotAnObject {
            message: "[native] must be an object".into(),
        })?;
    native_obj.insert("agents".into(), Value::Object(agents.clone()));
    native_obj.insert("categories".into(), Value::Object(categories.clone()));
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    if let Some(native_obj_spans) = native {
        for (key, map) in [("agents", agents), ("categories", categories)] {
            if let Some(member) = native_obj_spans.members.iter().find(|m| m.key == key) {
                let member_indent = line_indent(text, member.value_start);
                edits.push((
                    member.value_start,
                    member.value_end,
                    reindent(map, newline, &unit, &member_indent),
                ));
            } else {
                let member_indent = native_obj_spans.members.first().map_or_else(
                    || format!("{unit}{unit}"),
                    |member| line_indent(text, member.value_start),
                );
                let comma = native_obj_spans
                    .members
                    .last()
                    .is_some_and(|member| has_comma_after(text, member.value_end));
                let separator = if native_obj_spans.members.is_empty() || comma {
                    ""
                } else {
                    ","
                };
                edits.push((
                    native_obj_spans.end - 1,
                    native_obj_spans.end - 1,
                    format!(
                        "{separator}{newline}{member_indent}\"{key}\": {}{}",
                        reindent(map, newline, &unit, &member_indent),
                        if comma { "," } else { "" }
                    ),
                ));
            }
        }
    } else {
        let member_indent = root
            .members
            .first()
            .map_or_else(String::new, |member| line_indent(text, member.value_start));
        let member = native_member(agents, categories, newline, &unit, &member_indent);
        if let Some(opencode) = root
            .members
            .iter()
            .find(|member| member.key == "[opencode]")
        {
            let comma = skip(text, opencode.value_end)
                .ok()
                .and_then(|position| text.as_bytes().get(position))
                .is_some_and(|byte| *byte == b',');
            let insertion_at = skip(text, opencode.value_end)
                .map(|position| position + usize::from(comma))
                .map_err(|_| malformed(text, opencode.value_end, "invalid member separator"))?;
            edits.push((
                insertion_at,
                insertion_at,
                format!(
                    "{}{newline}{member_indent}{member}{}",
                    if comma { "" } else { "," },
                    if comma { "," } else { "" }
                ),
            ));
        } else if let Some(last) = root.members.last() {
            if has_comma_after(text, last.value_end) {
                edits.push((
                    root.end - 1,
                    root.end - 1,
                    format!("{member_indent}{member},{newline}"),
                ));
            } else {
                edits.push((
                    last.value_end,
                    last.value_end,
                    format!(",{newline}{member_indent}{member}"),
                ));
            }
        } else {
            edits.push((
                root.end - 1,
                root.end - 1,
                format!("{newline}{member_indent}{member}{newline}"),
            ));
        }
    }
    edits.sort_by(|a, b| b.0.cmp(&a.0));
    let mut result = text.to_owned();
    for (start, end, replacement) in edits {
        result.replace_range(start..end, &replacement);
    }
    let reparsed = parse_value(&result).map_err(|error| AppError::VerifyFailed {
        message: format!("{error}; generated={result}"),
    })?;
    if reparsed != expected {
        return Err(AppError::VerifyFailed {
            message: "edited JSONC did not match expected value".into(),
        });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(name: &str) -> &'static str {
        match name {
            "user" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/user_shaped.jsonc"
            )),
            "crlf" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/user_shaped_crlf.jsonc"
            )),
            "native" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/with_native.jsonc"
            )),
            "senpi" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/with_senpi.jsonc"
            )),
            "dup-native" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/dup_native.jsonc"
            )),
            "dup-agents" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/dup_agents.jsonc"
            )),
            "bad" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/malformed.jsonc"
            )),
            "empty" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/empty_object.jsonc"
            )),
            "insert-after-opencode" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/insert_after_opencode.jsonc"
            )),
            _ => unreachable!(),
        }
    }
    fn maps() -> (Map<String, Value>, Map<String, Value>) {
        let mut a = Map::new();
        a.insert(
            "sisyphus".into(),
            serde_json::json!({"model":"prov-a/model-x"}),
        );
        let mut c = Map::new();
        c.insert(
            "quick".into(),
            serde_json::json!({"model":"prov-b/model-y"}),
        );
        (a, c)
    }
    #[test]
    fn parse_and_find_keys() {
        assert!(parse_value(fixture("user")).is_ok());
        assert!(has_key(fixture("user"), "[opencode]").unwrap());
    }
    #[test]
    fn absent_native_is_empty() {
        assert_eq!(
            native_subtrees(fixture("user")).unwrap(),
            (Map::new(), Map::new())
        );
    }
    #[test]
    fn insert_native() {
        let (a, c) = maps();
        let out = set_native_subtrees(fixture("user"), &a, &c)
            .unwrap_or_else(|error| panic!("{error:?}"));
        assert!(has_key(&out, "[native]").unwrap());
    }
    #[test]
    fn replace_preserves_extra() {
        let (a, c) = maps();
        let out = set_native_subtrees(fixture("native"), &a, &c).unwrap();
        assert!(out.contains("keep-me"));
    }
    #[test]
    fn opencode_schema_migrations_preserved() {
        let (a, c) = maps();
        let old = fixture("user");
        let out = set_native_subtrees(old, &a, &c).unwrap();
        assert!(
            out.contains("$schema") && out.contains("_migrations") && out.contains("[opencode]")
        );
    }
    #[test]
    fn idempotent() {
        let (a, c) = maps();
        let once = set_native_subtrees(fixture("native"), &a, &c).unwrap();
        assert_eq!(set_native_subtrees(&once, &a, &c).unwrap(), once);
    }
    #[test]
    fn crlf_round_trip() {
        let (a, c) = maps();
        let out = set_native_subtrees(fixture("crlf"), &a, &c).unwrap();
        assert!(out.contains("\r\n"));
        assert!(!out.replace("\r\n", "").contains('\n'));
    }
    #[test]
    fn duplicate_native_rejected() {
        let result = has_key(fixture("dup-native"), "x");
        assert!(
            matches!(&result, Err(AppError::DuplicateKey { key, .. }) if key == "[native]"),
            "got {result:?}"
        );
    }
    #[test]
    fn duplicate_agents_rejected() {
        let result = native_subtrees(fixture("dup-agents"));
        assert!(
            matches!(&result, Err(AppError::DuplicateKey { key, .. }) if key == "agents"),
            "got {result:?}"
        );
    }
    #[test]
    fn malformed_reports_error() {
        assert!(matches!(
            parse_value(fixture("bad")),
            Err(AppError::MalformedJsonc { .. })
        ));
    }
    #[test]
    fn empty_object_insert() {
        let (a, c) = maps();
        assert!(set_native_subtrees(fixture("empty"), &a, &c).is_ok());
    }
    #[test]
    fn strings_do_not_confuse_scanner() {
        let (a, c) = maps();
        assert!(set_native_subtrees(fixture("senpi"), &a, &c).is_ok());
    }

    #[test]
    fn insert_after_opencode_is_valid_and_preserves_migrations() {
        let (a, c) = maps();
        let old = fixture("insert-after-opencode");
        let out = set_native_subtrees(old, &a, &c).unwrap();
        assert!(parse_value(&out).is_ok());
        let opencode_end = out.find("\"[opencode]\"").unwrap();
        let native_start = out.find("\"[native]\"").unwrap();
        let migrations_start = out.find("\"_migrations\"").unwrap();
        assert!(opencode_end < native_start && native_start < migrations_start);
        assert_eq!(
            &out[out.find("\"_migrations\"").unwrap()..],
            &old[old.find("\"_migrations\"").unwrap()..]
        );
    }

    #[test]
    fn append_native_without_opencode_has_no_trailing_comma() {
        let (a, c) = maps();
        let old = "{\n  \"other\": 1\n}\n";
        let out = set_native_subtrees(old, &a, &c).unwrap();
        assert!(parse_value(&out).is_ok());
        assert!(!out.contains("\"categories\": {},\n  }"));
        assert!(out.contains("\"[native]\": {\n"));
    }

    #[test]
    fn inserted_native_uses_document_indent_and_trailing_comma_style() {
        let (a, c) = maps();
        let no_trailing = set_native_subtrees(fixture("insert-after-opencode"), &a, &c).unwrap();
        assert!(no_trailing.contains("\n    \"agents\": {\n      \"sisyphus\""));
        assert!(!no_trailing.contains("\n  },\n}"));

        let trailing = set_native_subtrees(fixture("user"), &a, &c).unwrap();
        assert!(parse_value(&trailing).is_ok());
        assert!(trailing.contains("\n  },\n  \"_migrations\""));
    }

    #[test]
    fn insert_after_opencode_preserves_crlf() {
        let (a, c) = maps();
        let old = fixture("insert-after-opencode").replace('\n', "\r\n");
        let out = set_native_subtrees(&old, &a, &c).unwrap();
        assert!(!out.replace("\r\n", "").contains('\n'));
        assert!(parse_value(&out).is_ok());
    }
    #[test]
    fn native_round_trip_maps() {
        let (a, c) = maps();
        let out = set_native_subtrees(fixture("native"), &a, &c).unwrap();
        assert_eq!(native_subtrees(&out).unwrap(), (a, c));
    }
    #[test]
    fn missing_subtree_is_added() {
        let (a, c) = maps();
        let out = set_native_subtrees(fixture("native"), &a, &c).unwrap();
        let (x, y) = native_subtrees(&out).unwrap();
        assert_eq!(x, a);
        assert_eq!(y, c);
    }
    #[test]
    fn senpi_is_not_edited() {
        let (a, c) = maps();
        let out = set_native_subtrees(fixture("senpi"), &a, &c).unwrap();
        assert!(out.contains("[senpi]"));
    }
}
