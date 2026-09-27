use crate::error::AppError;
use serde_json::{Map, Value};

#[derive(Clone, Debug)]
struct Member {
    key: String,
    key_start: usize,
    value_start: usize,
    value_end: usize,
}

#[derive(Clone, Debug)]
struct Object {
    start: usize,
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
                start,
                end: p + 1,
                members,
            });
        }
        let key_start = p;
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
            key_start,
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
                start,
                end: p + 1,
                members,
            });
        }
        return Err(malformed(text, p, "expected ',' or '}'"));
    }
}

#[derive(Clone, Debug)]
struct PathResolution {
    value: Value,
    root: Object,
    parent: Object,
    member: Option<Member>,
    missing_at: usize,
}

fn duplicate_key(object: &Object) -> Result<(), AppError> {
    for (index, member) in object.members.iter().enumerate() {
        if object.members[..index]
            .iter()
            .any(|previous| previous.key == member.key)
        {
            return Err(AppError::DuplicateKey {
                key: member.key.clone(),
                message: "duplicate key".into(),
            });
        }
    }
    Ok(())
}

fn path_not_object(path: &[&str]) -> AppError {
    AppError::NotAnObject {
        message: format!("{} must be an object", path.join(".")),
    }
}

fn require_path(path: &[&str]) -> Result<(), AppError> {
    if path.is_empty() {
        return Err(AppError::MalformedJsonc {
            message: "object path must not be empty".into(),
            line: 1,
            col: 1,
        });
    }
    Ok(())
}

fn resolve_path(text: &str, path: &[&str]) -> Result<PathResolution, AppError> {
    let root_start = skip(text, 0)?;
    if text.as_bytes().get(root_start) != Some(&b'{') {
        return Err(path_not_object(&[]));
    }
    let root = object_at(text, root_start)?;
    let value = parse_value(text)?;
    let mut parent = root.clone();
    for (index, key) in path.iter().enumerate() {
        duplicate_key(&parent)?;
        let member = parent
            .members
            .iter()
            .find(|member| member.key == *key)
            .cloned();
        let Some(member) = member else {
            return Ok(PathResolution {
                value,
                root,
                parent,
                member: None,
                missing_at: index,
            });
        };
        if index + 1 == path.len() {
            return Ok(PathResolution {
                value,
                root,
                parent,
                member: Some(member),
                missing_at: path.len(),
            });
        }
        if text.as_bytes().get(member.value_start) != Some(&b'{') {
            return Err(path_not_object(&path[..=index]));
        }
        parent = object_at(text, member.value_start)?;
    }
    duplicate_key(&parent)?;
    Ok(PathResolution {
        value,
        root,
        parent,
        member: None,
        missing_at: 0,
    })
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
    Ok(resolve_path(text, &[top_key])?.member.is_some())
}

fn pretty(value: &Value, newline: &str) -> String {
    serde_json::to_string_pretty(value)
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

fn reindent(value: &Value, newline: &str, unit: &str, base: &str) -> String {
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

fn member_indent(text: &str, object: &Object, unit: &str) -> String {
    object.members.first().map_or_else(
        || format!("{}{}", line_indent(text, object.start), unit),
        |member| line_indent(text, member.key_start),
    )
}

fn insert_member(
    text: &str,
    object: &Object,
    key: &str,
    value: &Value,
    path: &[&str],
    newline: &str,
    unit: &str,
) -> Result<(usize, String), AppError> {
    let key_text = serde_json::to_string(key).unwrap_or_else(|_| format!("\"{key}\""));
    let indent = member_indent(text, object, unit);
    let value_text = reindent(value, newline, unit, &indent);
    let member = format!("{key_text}: {value_text}");

    if object.members.is_empty() {
        let base = line_indent(text, object.start);
        return Ok((
            object.end - 1,
            format!("{newline}{indent}{member}{newline}{base}"),
        ));
    }

    if path.first() == Some(&"[native]") && path.len() > 1 && object.start == skip(text, 0)? {
        if let Some(opencode) = object.members.iter().find(|m| m.key == "[opencode]") {
            let after_value = skip(text, opencode.value_end)?;
            if text.as_bytes().get(after_value) == Some(&b',') {
                return Ok((after_value + 1, format!("{newline}{indent}{member},")));
            }
            return Ok((opencode.value_end, format!(",{newline}{indent}{member}")));
        }
    }

    let last = object
        .members
        .last()
        .ok_or_else(|| malformed(text, object.start, "object has no members"))?;
    if has_comma_after(text, last.value_end) {
        Ok((object.end - 1, format!("{indent}{member}{newline}")))
    } else {
        Ok((last.value_end, format!(",{newline}{indent}{member}")))
    }
}

fn set_expected(root: &mut Value, path: &[&str], replacement: &Value) -> Result<(), AppError> {
    let mut current = root;
    for (index, key) in path[..path.len() - 1].iter().enumerate() {
        let object = current
            .as_object_mut()
            .ok_or_else(|| path_not_object(&path[..=index]))?;
        let child = object
            .entry((*key).to_owned())
            .or_insert_with(|| Value::Object(Map::new()));
        if !child.is_object() {
            return Err(path_not_object(&path[..=index + 1]));
        }
        current = child;
    }
    let object = current
        .as_object_mut()
        .ok_or_else(|| path_not_object(&path[..path.len() - 1]))?;
    object.insert(path[path.len() - 1].to_owned(), replacement.clone());
    Ok(())
}

fn edited_result(
    text: &str,
    mut edits: Vec<(usize, usize, String)>,
    expected: &Value,
) -> Result<String, AppError> {
    edits.sort_by(|left, right| right.0.cmp(&left.0));
    let mut result = text.to_owned();
    for (start, end, replacement) in edits {
        result.replace_range(start..end, &replacement);
    }
    let reparsed = parse_value(&result).map_err(|error| AppError::VerifyFailed {
        message: format!("{error}; generated={result}"),
    })?;
    if &reparsed != expected {
        return Err(AppError::VerifyFailed {
            message: format!("edited JSONC did not match expected value; generated={result}"),
        });
    }
    Ok(result)
}

pub fn set_object_path(text: &str, path: &[&str], value: &Value) -> Result<String, AppError> {
    require_path(path)?;
    let resolution = resolve_path(text, path)?;
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let unit = indent_unit(text, &resolution.root);
    let mut expected = resolution.value.clone();
    set_expected(&mut expected, path, value)?;

    let Some(member) = resolution.member else {
        let mut missing_value = value.clone();
        for key in path[resolution.missing_at + 1..path.len()].iter().rev() {
            let mut object = Map::new();
            object.insert((*key).to_owned(), missing_value);
            missing_value = Value::Object(object);
        }
        let (at, insertion) = insert_member(
            text,
            &resolution.parent,
            path[resolution.missing_at],
            &missing_value,
            path,
            newline,
            &unit,
        )?;
        return edited_result(text, vec![(at, at, insertion)], &expected);
    };

    let indent = line_indent(text, member.key_start);
    edited_result(
        text,
        vec![(
            member.value_start,
            member.value_end,
            reindent(value, newline, &unit, &indent),
        )],
        &expected,
    )
}

pub fn get_object_path(text: &str, path: &[&str]) -> Result<Option<Value>, AppError> {
    require_path(path)?;
    let resolution = resolve_path(text, path)?;
    let mut current = resolution.value;
    for key in path {
        let Some(object) = current.as_object() else {
            return Err(path_not_object(path));
        };
        let Some(value) = object.get(*key) else {
            return Ok(None);
        };
        current = value.clone();
    }
    Ok(Some(current))
}

pub fn remove_object_path(text: &str, path: &[&str]) -> Result<String, AppError> {
    require_path(path)?;
    let resolution = resolve_path(text, path)?;
    let Some(member) = resolution.member else {
        return Ok(text.to_owned());
    };
    let mut edits = vec![(member.key_start, member.value_end, String::new())];
    if let Some(comma) = skip(text, member.value_end)
        .ok()
        .filter(|position| text.as_bytes().get(*position) == Some(&b','))
    {
        edits.push((comma, comma + 1, String::new()));
    } else if let Some(index) = resolution
        .parent
        .members
        .iter()
        .position(|candidate| candidate.key_start == member.key_start)
        .and_then(|index| index.checked_sub(1))
    {
        let previous = &resolution.parent.members[index];
        let comma = skip(text, previous.value_end)?;
        if text.as_bytes().get(comma) != Some(&b',') {
            return Err(malformed(text, comma, "expected member separator"));
        }
        edits.push((comma, comma + 1, String::new()));
    }
    let mut expected = resolution.value;
    let mut current = &mut expected;
    for key in &path[..path.len() - 1] {
        current = current
            .as_object_mut()
            .and_then(|object| object.get_mut(*key))
            .ok_or_else(|| path_not_object(path))?;
    }
    let object = current
        .as_object_mut()
        .ok_or_else(|| path_not_object(path))?;
    object.remove(path[path.len() - 1]);
    edited_result(text, edits, &expected)
}

pub fn native_subtrees(text: &str) -> Result<(Map<String, Value>, Map<String, Value>), AppError> {
    let get = |path: &[&str]| -> Result<Map<String, Value>, AppError> {
        match get_object_path(text, path)? {
            None => Ok(Map::new()),
            Some(Value::Object(map)) => Ok(map),
            Some(_) => Err(AppError::NotAnObject {
                message: format!("{} must be an object", path.join(".")),
            }),
        }
    };
    Ok((
        get(&["[native]", "agents"])?,
        get(&["[native]", "categories"])?,
    ))
}

pub fn set_native_subtrees(
    text: &str,
    agents: &Map<String, Value>,
    categories: &Map<String, Value>,
) -> Result<String, AppError> {
    let with_agents = set_object_path(
        text,
        &["[native]", "agents"],
        &Value::Object(agents.clone()),
    )?;
    set_object_path(
        &with_agents,
        &["[native]", "categories"],
        &Value::Object(categories.clone()),
    )
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
            "models-commented" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/models_json_commented.jsonc"
            )),
            "models-crlf" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/models_json_crlf.jsonc"
            )),
            "models-empty" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/models_json_empty.jsonc"
            )),
            "models-dup" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/models_json_dup_providers.jsonc"
            )),
            "models-disabled" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/models_json_disabled.jsonc"
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

    #[test]
    fn nested_insert_into_missing_providers() {
        let value = serde_json::json!({"name": "fake-provider"});
        let out = set_object_path(
            fixture("models-empty"),
            &["providers", "wawazz-gpt"],
            &value,
        )
        .unwrap();
        assert_eq!(
            get_object_path(&out, &["providers", "wawazz-gpt"]).unwrap(),
            Some(value)
        );
    }

    #[test]
    fn replace_provider_preserves_sibling_bytes() {
        let old = fixture("models-disabled");
        let start = old.find("\"TEST-NOT-A-REAL-KEY\"").unwrap();
        let end = old[start..].find("\n  },").unwrap() + start;
        let prefix = &old[..start];
        let suffix = &old[end..];
        let out = set_object_path(
            old,
            &["providers", "TEST-NOT-A-REAL-KEY"],
            &serde_json::json!({"name": "replacement"}),
        )
        .unwrap();
        assert_eq!(&out[..prefix.len()], prefix);
        assert_eq!(&out[out.len() - suffix.len()..], suffix);
    }

    #[test]
    fn models_crlf_stays_crlf() {
        let old = fixture("models-crlf");
        assert!(old.contains("\r\n"));
        let out = set_object_path(
            &old,
            &["providers", "new-provider"],
            &serde_json::json!({"name": "fake-provider"}),
        )
        .unwrap();
        assert!(!out.replace("\r\n", "").contains('\n'));
    }

    #[test]
    fn setting_same_value_is_idempotent() {
        let value = serde_json::json!({"name": "replacement"});
        let once = set_object_path(
            fixture("models-disabled"),
            &["providers", "TEST-NOT-A-REAL-KEY"],
            &value,
        )
        .unwrap();
        assert_eq!(
            set_object_path(&once, &["providers", "TEST-NOT-A-REAL-KEY"], &value).unwrap(),
            once
        );
    }

    #[test]
    fn comments_survive_provider_update() {
        let old = fixture("models-commented");
        let out = set_object_path(
            old,
            &["providers", "TEST-NOT-A-REAL-KEY"],
            &serde_json::json!({"name": "replacement"}),
        )
        .unwrap();
        for comment in [
            "comment before providers",
            "comment before providers member",
            "comment inside providers",
            "block comment inside providers",
            "comment after providers",
            "comment after providers object",
        ] {
            assert!(out.contains(comment), "missing comment: {comment}");
        }
    }

    #[test]
    fn remove_provider_fixes_comma_and_keeps_sibling() {
        let old = "{\n  \"providers\": {\n    \"first\": 1,\n    \"second\": 2,\n  },\n}";
        let out = remove_object_path(old, &["providers", "first"]).unwrap();
        assert_eq!(parse_value(&out).unwrap()["providers"]["second"], 2);
        assert!(out.contains("\"second\": 2"));
    }

    #[test]
    fn duplicate_key_at_depth_is_rejected() {
        let result = get_object_path(fixture("models-dup"), &["providers", "x"]);
        assert!(matches!(result, Err(AppError::DuplicateKey { key, .. }) if key == "providers"));
    }

    #[test]
    fn path_through_non_object_is_rejected() {
        let result = set_object_path(
            fixture("models-disabled"),
            &["disabledProviders", "x"],
            &serde_json::json!(true),
        );
        assert!(matches!(result, Err(AppError::NotAnObject { .. })));
    }

    #[test]
    fn empty_path_is_rejected() {
        let result = get_object_path(fixture("models-empty"), &[]);
        assert!(matches!(result, Err(AppError::MalformedJsonc { .. })));
    }

    #[test]
    fn missing_remove_is_unchanged() {
        let old = fixture("models-disabled");
        assert_eq!(
            remove_object_path(old, &["providers", "missing"]).unwrap(),
            old
        );
    }

    #[test]
    fn native_wrappers_use_object_paths() {
        let (agents, categories) = maps();
        let out = set_native_subtrees(fixture("empty"), &agents, &categories).unwrap();
        assert_eq!(native_subtrees(&out).unwrap(), (agents, categories));
    }
}
