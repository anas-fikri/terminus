#[tauri::command]
pub async fn fetch_remote_html(url: String) -> Result<String, String> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http and https URLs are supported".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Terminus/1.0")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch {url}: {e}"))?;

    let response = response
        .error_for_status()
        .map_err(|e| format!("Failed to fetch {url}: {e}"))?;

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read {url}: {e}"))
}