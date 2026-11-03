use std::time::Duration;

use semver::Version;
use serde::{Deserialize, Serialize};

pub const GITHUB_OWNER: &str = "david0304git";
pub const GITHUB_REPO: &str = "reciprocal";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    html_url: String,
    #[serde(default)]
    published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GitHubTag {
    name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub release_url: Option<String>,
    pub release_name: Option<String>,
    pub published_at: Option<String>,
    /// "release" | "tag" | "none"
    pub source: String,
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(format!("Reciprocal/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("無法建立網路連線：{error}"))
}

fn normalize_version(tag: &str) -> String {
    tag.trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .trim()
        .to_string()
}

fn is_newer(latest: &str, current: &str) -> bool {
    match (Version::parse(latest), Version::parse(current)) {
        (Ok(latest), Ok(current)) => latest > current,
        _ => latest != current,
    }
}

fn result(
    current: &str,
    latest: Option<String>,
    release_url: Option<String>,
    release_name: Option<String>,
    published_at: Option<String>,
    source: &str,
) -> UpdateCheck {
    let update_available = latest
        .as_deref()
        .map(|version| is_newer(version, current))
        .unwrap_or(false);
    UpdateCheck {
        current_version: current.to_string(),
        latest_version: latest,
        update_available,
        release_url,
        release_name,
        published_at,
        source: source.to_string(),
    }
}

pub fn check(current: &str) -> Result<UpdateCheck, String> {
    let client = client()?;
    let release_api = format!(
        "https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
    );

    let response = client
        .get(&release_api)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|error| format!("無法連線到 GitHub：{error}"))?;

    if response.status().is_success() {
        let release: GitHubRelease = response
            .json()
            .map_err(|error| format!("無法解析 GitHub Release：{error}"))?;
        let latest = normalize_version(&release.tag_name);
        let name = release
            .name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| release.tag_name.clone());
        return Ok(result(
            current,
            Some(latest),
            Some(release.html_url),
            Some(name),
            release.published_at.clone(),
            "release",
        ));
    }

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        let tags_api = format!("https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/tags");
        let tags_response = client
            .get(&tags_api)
            .header("Accept", "application/vnd.github+json")
            .send()
            .map_err(|error| format!("無法連線到 GitHub：{error}"))?;
        if tags_response.status().is_success() {
            let tags: Vec<GitHubTag> = tags_response
                .json()
                .map_err(|error| format!("無法解析 GitHub Tags：{error}"))?;
            if let Some(tag) = tags.first() {
                let latest = normalize_version(&tag.name);
                let url = format!(
                    "https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/tag/{}",
                    tag.name
                );
                return Ok(result(
                    current,
                    Some(latest),
                    Some(url),
                    Some(tag.name.clone()),
                    None,
                    "tag",
                ));
            }
            return Ok(result(current, None, None, None, None, "none"));
        }
        return Err(format!("無法讀取 GitHub 版本：{}", tags_response.status()));
    }

    Err(format!(
        "GitHub API 回應異常：{}（可能超過未登入查詢次數）",
        response.status()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_version_tags() {
        assert_eq!(normalize_version("v0.2.0"), "0.2.0");
        assert_eq!(normalize_version("V1.2.3"), "1.2.3");
        assert_eq!(normalize_version(" 0.1.0 "), "0.1.0");
    }

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.2.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
        assert!(is_newer("1.0.0", "0.9.9"));
    }

    #[test]
    fn parses_github_release_payload() {
        let payload = r#"{"tag_name":"v0.2.0","name":"Reciprocal v0.2.0","html_url":"https://github.com/david0304git/reciprocal/releases/tag/v0.2.0","published_at":"2026-11-02T07:10:24Z"}"#;
        let release: GitHubRelease = serde_json::from_str(payload).unwrap();
        assert_eq!(normalize_version(&release.tag_name), "0.2.0");
        assert_eq!(release.html_url, "https://github.com/david0304git/reciprocal/releases/tag/v0.2.0");
        assert_eq!(release.name.as_deref(), Some("Reciprocal v0.2.0"));
    }

    #[test]
    #[ignore = "requires network and an existing GitHub release"]
    fn live_github_check() {
        let result = check("0.1.7").expect("GitHub check failed");
        eprintln!("{result:?}");
        assert!(!result.source.is_empty());
    }
}
