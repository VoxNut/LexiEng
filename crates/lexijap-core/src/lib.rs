use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Cursor, Read};
use unicode_normalization::UnicodeNormalization;
use wasm_bindgen::prelude::*;
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub node_index: usize,
    pub start: usize,
    pub end: usize,
    pub surface: String,
    pub normalized: String,
    pub candidates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryMetadata {
    pub title: String,
    pub revision: String,
    pub format: u64,
    pub sequenced: bool,
    pub author: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
    pub attribution: Option<String>,
    pub stylesheet: Option<String>,
    pub bank_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermRecord {
    pub headword: String,
    pub normalized: String,
    pub lookup_keys: Vec<String>,
    pub reading: String,
    pub definition_tags: String,
    pub rules: String,
    pub score: i64,
    pub glossary: Value,
    pub sequence: i64,
    pub term_tags: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaRecord {
    pub headword: String,
    pub normalized: String,
    pub lookup_keys: Vec<String>,
    pub mode: String,
    pub data: Value,
    pub frequency_rank: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "records", rename_all = "camelCase")]
pub enum ImportBatch {
    Terms(Vec<TermRecord>),
    Metadata(Vec<MetaRecord>),
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BankKind {
    Terms,
    Metadata,
}

#[derive(Debug, Clone)]
struct Bank {
    name: String,
    kind: BankKind,
}

enum ParsedBank {
    Terms(Vec<TermRecord>),
    Metadata(Vec<MetaRecord>),
}

#[wasm_bindgen]
pub struct YomitanArchive {
    archive: ZipArchive<Cursor<Vec<u8>>>,
    metadata: DictionaryMetadata,
    banks: Vec<Bank>,
    bank_index: usize,
    row_index: usize,
    current: Option<ParsedBank>,
    emitted_rows: usize,
}

#[wasm_bindgen]
impl YomitanArchive {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<YomitanArchive, JsValue> {
        Self::new_inner(bytes).map_err(js_error)
    }

    pub fn metadata(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.metadata).map_err(js_error)
    }

    pub fn next_batch(&mut self, batch_size: usize) -> Result<JsValue, JsValue> {
        let batch_size = batch_size.clamp(1, 2_000);

        loop {
            if let Some(batch) = self.take_current_batch(batch_size) {
                return serde_wasm_bindgen::to_value(&batch).map_err(js_error);
            }

            if self.bank_index >= self.banks.len() {
                return serde_wasm_bindgen::to_value(&ImportBatch::Done).map_err(js_error);
            }

            self.load_next_bank().map_err(js_error)?;
        }
    }

    pub fn progress(&self) -> f64 {
        if self.banks.is_empty() {
            return 1.0;
        }

        let current_fraction = match &self.current {
            Some(ParsedBank::Terms(rows)) if !rows.is_empty() => {
                self.row_index as f64 / rows.len() as f64
            }
            Some(ParsedBank::Metadata(rows)) if !rows.is_empty() => {
                self.row_index as f64 / rows.len() as f64
            }
            _ => 0.0,
        };

        ((self
            .bank_index
            .saturating_sub(usize::from(self.current.is_some()))) as f64
            + current_fraction)
            / self.banks.len() as f64
    }

    pub fn emitted_rows(&self) -> usize {
        self.emitted_rows
    }
}

impl YomitanArchive {
    fn new_inner(bytes: Vec<u8>) -> Result<YomitanArchive, String> {
        let cursor = Cursor::new(bytes);
        let mut archive = ZipArchive::new(cursor).map_err(error_string)?;
        let index = read_json_entry(&mut archive, "index.json")?;
        let metadata = parse_dictionary_metadata(&index, &mut archive)?;

        let mut banks = Vec::new();
        for name in archive.file_names().map(str::to_owned) {
            if is_numbered_json_bank(&name, "term_bank") {
                banks.push(Bank {
                    name,
                    kind: BankKind::Terms,
                });
            } else if is_numbered_json_bank(&name, "term_meta_bank") {
                banks.push(Bank {
                    name,
                    kind: BankKind::Metadata,
                });
            }
        }
        banks.sort_by_key(|bank| natural_bank_key(&bank.name));

        let mut metadata = metadata;
        metadata.bank_count = banks.len();

        Ok(Self {
            archive,
            metadata,
            banks,
            bank_index: 0,
            row_index: 0,
            current: None,
            emitted_rows: 0,
        })
    }

    fn load_next_bank(&mut self) -> Result<(), String> {
        let bank = self
            .banks
            .get(self.bank_index)
            .ok_or_else(|| "Dictionary bank index is out of range".to_owned())?
            .clone();
        self.bank_index += 1;
        self.row_index = 0;

        let value = read_json_entry(&mut self.archive, &bank.name)?;
        let rows = value
            .as_array()
            .ok_or_else(|| format!("{} is not a JSON array", bank.name))?;

        self.current = Some(match bank.kind {
            BankKind::Terms => {
                ParsedBank::Terms(rows.iter().filter_map(parse_term_record).collect())
            }
            BankKind::Metadata => {
                ParsedBank::Metadata(rows.iter().filter_map(parse_meta_record).collect())
            }
        });
        Ok(())
    }

    fn take_current_batch(&mut self, batch_size: usize) -> Option<ImportBatch> {
        let (len, batch) = match self.current.as_ref()? {
            ParsedBank::Terms(rows) => {
                let end = (self.row_index + batch_size).min(rows.len());
                let batch = ImportBatch::Terms(rows[self.row_index..end].to_vec());
                (rows.len(), batch)
            }
            ParsedBank::Metadata(rows) => {
                let end = (self.row_index + batch_size).min(rows.len());
                let batch = ImportBatch::Metadata(rows[self.row_index..end].to_vec());
                (rows.len(), batch)
            }
        };

        let emitted = match &batch {
            ImportBatch::Terms(rows) => rows.len(),
            ImportBatch::Metadata(rows) => rows.len(),
            ImportBatch::Done => 0,
        };
        self.row_index += emitted;
        self.emitted_rows += emitted;

        if emitted == 0 || self.row_index >= len {
            self.current = None;
        }

        (emitted > 0).then_some(batch)
    }
}

#[wasm_bindgen]
pub fn tokenize_nodes(nodes: JsValue) -> Result<JsValue, JsValue> {
    let nodes: Vec<String> = serde_wasm_bindgen::from_value(nodes).map_err(js_error)?;
    let result: Vec<Token> = nodes
        .iter()
        .enumerate()
        .flat_map(|(index, text)| tokenize_node(index, text))
        .collect();
    serde_wasm_bindgen::to_value(&result).map_err(js_error)
}

#[wasm_bindgen]
pub fn lookup_candidates(term: &str) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&candidate_forms(term)).map_err(js_error)
}

pub fn tokenize_node(node_index: usize, input: &str) -> Vec<Token> {
    let chars: Vec<(usize, char)> = input.char_indices().collect();
    let mut tokens = Vec::new();
    let mut cursor = 0;

    while cursor < chars.len() {
        if !chars[cursor].1.is_alphabetic() {
            cursor += 1;
            continue;
        }

        let start_cursor = cursor;
        cursor += 1;
        while cursor < chars.len() {
            let current = chars[cursor].1;
            let surrounded_punctuation = matches!(current, '\'' | '\u{2019}' | '-')
                && cursor + 1 < chars.len()
                && chars[cursor - 1].1.is_alphabetic()
                && chars[cursor + 1].1.is_alphabetic();
            if current.is_alphabetic() || surrounded_punctuation {
                cursor += 1;
            } else {
                break;
            }
        }

        let byte_start = chars[start_cursor].0;
        let byte_end = chars.get(cursor).map_or(input.len(), |(index, _)| *index);
        let surface = input[byte_start..byte_end].to_owned();
        let normalized = normalize_term(&surface);
        if normalized.len() < 2 && normalized != "a" && normalized != "i" {
            continue;
        }

        let start = input[..byte_start].encode_utf16().count();
        let end = start + surface.encode_utf16().count();
        let candidates = candidate_forms(&normalized);
        tokens.push(Token {
            node_index,
            start,
            end,
            surface,
            normalized,
            candidates,
        });
    }

    tokens
}

pub fn normalize_term(term: &str) -> String {
    term.nfkc()
        .collect::<String>()
        .to_lowercase()
        .replace('\u{2019}', "'")
        .trim_matches(|character: char| !character.is_alphanumeric())
        .to_owned()
}

pub fn candidate_forms(term: &str) -> Vec<String> {
    let word = normalize_term(term);
    let mut candidates = Vec::with_capacity(8);
    push_unique(&mut candidates, word.clone());

    if let Some(base) = word.strip_suffix("'s") {
        push_unique(&mut candidates, base.to_owned());
    }

    if word.len() > 4 {
        if let Some(stem) = word.strip_suffix("ies") {
            push_unique(&mut candidates, format!("{stem}y"));
        } else if let Some(stem) = word.strip_suffix("ves") {
            push_unique(&mut candidates, format!("{stem}f"));
            push_unique(&mut candidates, format!("{stem}fe"));
        } else if let Some(stem) = word.strip_suffix("es") {
            push_unique(&mut candidates, stem.to_owned());
            push_unique(&mut candidates, word.trim_end_matches('s').to_owned());
        } else if let Some(stem) = word.strip_suffix('s') {
            push_unique(&mut candidates, stem.to_owned());
        }
    }

    for suffix in ["ing", "ed", "er", "est"] {
        if word.len() <= suffix.len() + 2 || !word.ends_with(suffix) {
            continue;
        }
        let stem = &word[..word.len() - suffix.len()];
        push_unique(&mut candidates, stem.to_owned());
        push_unique(&mut candidates, format!("{stem}e"));
        if has_doubled_final_consonant(stem) {
            push_unique(&mut candidates, stem[..stem.len() - 1].to_owned());
        }
        if suffix == "ed" && stem.ends_with('i') {
            push_unique(&mut candidates, format!("{}y", &stem[..stem.len() - 1]));
        }
    }

    candidates
}

fn parse_dictionary_metadata(
    index: &Value,
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
) -> Result<DictionaryMetadata, String> {
    let stylesheet = ["dictionary.css", "styles.css"]
        .iter()
        .find_map(|name| read_text_entry(archive, name).ok());

    Ok(DictionaryMetadata {
        title: string_field(index, "title").unwrap_or_else(|| "Untitled dictionary".to_owned()),
        revision: string_field(index, "revision").unwrap_or_else(|| "unknown".to_owned()),
        format: index
            .get("format")
            .or_else(|| index.get("version"))
            .and_then(Value::as_u64)
            .unwrap_or(3),
        sequenced: index
            .get("sequenced")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        author: string_field(index, "author"),
        url: string_field(index, "url"),
        description: string_field(index, "description"),
        attribution: string_field(index, "attribution"),
        stylesheet,
        bank_count: 0,
    })
}

fn parse_term_record(row: &Value) -> Option<TermRecord> {
    let row = row.as_array()?;
    let headword = row.first()?.as_str()?.to_owned();
    let normalized = normalize_term(&headword);
    if normalized.is_empty() {
        return None;
    }
    let reading = row
        .get(1)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let mut lookup_keys = candidate_forms(&headword);
    let normalized_reading = normalize_term(&reading);
    if !normalized_reading.is_empty() {
        push_unique(&mut lookup_keys, normalized_reading);
    }

    Some(TermRecord {
        headword,
        normalized,
        lookup_keys,
        reading,
        definition_tags: row
            .get(2)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        rules: row
            .get(3)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        score: row.get(4).and_then(Value::as_i64).unwrap_or_default(),
        glossary: row
            .get(5)
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new())),
        sequence: row.get(6).and_then(Value::as_i64).unwrap_or_default(),
        term_tags: row
            .get(7)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
    })
}

fn parse_meta_record(row: &Value) -> Option<MetaRecord> {
    let row = row.as_array()?;
    let headword = row.first()?.as_str()?.to_owned();
    let mode = row.get(1)?.as_str()?.to_owned();
    let data = row.get(2).cloned().unwrap_or(Value::Null);
    let normalized = normalize_term(&headword);
    if normalized.is_empty() {
        return None;
    }
    let mut lookup_keys = candidate_forms(&headword);
    if let Some(reading) = data.get("reading").and_then(Value::as_str) {
        push_unique(&mut lookup_keys, normalize_term(reading));
    }
    let frequency_rank = if mode == "freq" {
        parse_frequency_rank(&data)
    } else {
        None
    };

    Some(MetaRecord {
        headword,
        normalized,
        lookup_keys,
        mode,
        data,
        frequency_rank,
    })
}

fn parse_frequency_rank(value: &Value) -> Option<f64> {
    let frequency = value.get("frequency").unwrap_or(value);
    match frequency {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text
            .replace(',', "")
            .split_whitespace()
            .find_map(|part| part.parse::<f64>().ok()),
        Value::Object(map) => map
            .get("value")
            .or_else(|| map.get("frequency"))
            .and_then(parse_frequency_rank),
        _ => None,
    }
}

fn read_json_entry(archive: &mut ZipArchive<Cursor<Vec<u8>>>, name: &str) -> Result<Value, String> {
    let text = read_text_entry(archive, name)?;
    serde_json::from_str(&text).map_err(error_string)
}

fn read_text_entry(
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
    name: &str,
) -> Result<String, String> {
    let mut file = archive.by_name(name).map_err(error_string)?;
    let mut text = String::with_capacity(file.size().min(usize::MAX as u64) as usize);
    file.read_to_string(&mut text).map_err(error_string)?;
    Ok(text)
}

fn is_numbered_json_bank(name: &str, prefix: &str) -> bool {
    if !name.ends_with(".json") || !name.starts_with(prefix) {
        return false;
    }
    let suffix = &name[prefix.len()..name.len() - 5];
    suffix.strip_prefix('_').is_some_and(|number| {
        !number.is_empty() && number.chars().all(|character| character.is_ascii_digit())
    })
}

fn natural_bank_key(name: &str) -> (u8, u64, String) {
    let kind = if name.starts_with("term_bank") { 0 } else { 1 };
    let number = name
        .trim_end_matches(".json")
        .rsplit('_')
        .next()
        .and_then(|part| part.parse().ok())
        .unwrap_or_default();
    (kind, number, name.to_owned())
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn has_doubled_final_consonant(stem: &str) -> bool {
    let mut characters = stem.chars().rev();
    match (characters.next(), characters.next()) {
        (Some(first), Some(second)) => {
            first == second && !matches!(first, 'a' | 'e' | 'i' | 'o' | 'u')
        }
        _ => false,
    }
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !value.is_empty() && !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn error_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn tokenizes_english_with_utf16_offsets() {
        let tokens = tokenize_node(3, "🙂 Readers' well-known choices.");
        assert_eq!(tokens.len(), 3);
        assert_eq!(tokens[0].surface, "Readers");
        assert_eq!(tokens[0].start, 3);
        assert_eq!(tokens[1].surface, "well-known");
        assert_eq!(tokens[2].surface, "choices");
    }

    #[test]
    fn creates_useful_inflection_candidates() {
        assert_eq!(candidate_forms("studies"), vec!["studies", "study"]);
        assert!(candidate_forms("running").contains(&"run".to_owned()));
        assert!(candidate_forms("baked").contains(&"bake".to_owned()));
        assert!(candidate_forms("wolves").contains(&"wolf".to_owned()));
    }

    #[test]
    fn extracts_frequency_shapes() {
        assert_eq!(
            parse_frequency_rank(&serde_json::json!({"frequency": 20_001})),
            Some(20_001.0)
        );
        assert_eq!(
            parse_frequency_rank(&serde_json::json!({"frequency": "12,345 occurrence"})),
            Some(12_345.0)
        );
    }

    #[test]
    fn parses_term_and_ipa_rows() {
        let term = parse_term_record(&serde_json::json!([
            "dictionaries",
            "",
            "noun",
            "",
            5,
            ["books of words"],
            1,
            "common"
        ]))
        .unwrap();
        assert!(term.lookup_keys.contains(&"dictionary".to_owned()));

        let ipa = parse_meta_record(&serde_json::json!([
            "dictionary", "ipa", {"reading": "dictionary", "transcriptions": [{"ipa": "/test/"}]}
        ]))
        .unwrap();
        assert_eq!(ipa.mode, "ipa");
    }

    #[test]
    #[ignore = "set LEXIJAP_DICTIONARY_DIR to validate external dictionary archives"]
    fn validates_external_archive_directory() {
        let directory = std::env::var("LEXIJAP_DICTIONARY_DIR")
            .expect("LEXIJAP_DICTIONARY_DIR must point to a folder of Yomitan ZIP files");
        let mut paths = std::fs::read_dir(directory)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "zip"))
            .collect::<Vec<_>>();
        paths.sort();
        assert!(!paths.is_empty(), "No ZIP files were found");

        for path in paths {
            let bytes = std::fs::read(&path).unwrap();
            let mut archive = YomitanArchive::new_inner(bytes).unwrap();
            while archive.bank_index < archive.banks.len() {
                archive.load_next_bank().unwrap();
                while archive.take_current_batch(2_000).is_some() {}
            }
            assert!(
                archive.emitted_rows > 0,
                "{} did not contain supported term or metadata rows",
                path.display()
            );
            eprintln!(
                "validated {}: {} rows",
                path.file_name().unwrap().to_string_lossy(),
                archive.emitted_rows
            );
        }
    }
}
