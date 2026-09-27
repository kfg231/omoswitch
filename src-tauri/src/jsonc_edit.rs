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
        if p >= text.len() { return Ok(p); }
        if p < text.len() && text[p..].starts_with("//") {
            p += 2;
            while text.as_bytes().get(p).is_some_and(|b| *b != b'\n') {
                p += 1;
            }
            if p >= text.len() { return Ok(p); }
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
            if steps > text.len().saturating_mul(2) { return Err(malformed(text, p, "value scan made no progress")); }
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
        if steps > text.len().saturating_mul(2) { return Err(malformed(text, p, format!("object scan made no progress at byte {p}"))); }
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
            json5::Error::Message { location: Some(ref location), .. } => {
                (location.line, location.column)
            }
            json5::Error::Message { location: None, .. } => (1, 1),
        };
        AppError::MalformedJsonc { message: error.to_string(), line, col }
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

pub fn set_native_subtrees(
    text: &str,
    agents: &Map<String, Value>,
    categories: &Map<String, Value>,
) -> Result<String, AppError> {
    let (mut expected, root, native) = root_and_native(text)?;
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
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
                edits.push((member.value_start, member.value_end, pretty(map, newline)));
            } else {
                edits.push((
                    native_obj_spans.end - 1,
                    native_obj_spans.end - 1,
                    format!("{newline}  \"{key}\": {},", pretty(map, newline)),
                ));
            }
        }
    } else {
        let indent = "  ";
        let insertion = format!("{newline}{indent}\"[native]\": {{{newline}{indent}{indent}\"agents\": {},{newline}{indent}{indent}\"categories\": {}{newline}{indent}}},{newline}", pretty(agents, newline), pretty(categories, newline));
        edits.push((root.end - 1, root.end - 1, insertion));
    }
    edits.sort_by(|a, b| b.0.cmp(&a.0));
    let mut result = text.to_owned();
    for (start, end, replacement) in edits {
        result.replace_range(start..end, &replacement);
    }
    let reparsed = parse_value(&result).map_err(|error| AppError::VerifyFailed { message: format!("{error}; generated={result}"), })?;
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
        let out = set_native_subtrees(fixture("user"), &a, &c).unwrap_or_else(|error| panic!("{error:?}"));
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
        assert!(matches!(&result, Err(AppError::DuplicateKey { key, .. }) if key == "[native]"), "got {result:?}");
    }
    #[test]
    fn duplicate_agents_rejected() {
        let result = native_subtrees(fixture("dup-agents"));
        assert!(matches!(&result, Err(AppError::DuplicateKey { key, .. }) if key == "agents"), "got {result:?}");
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
