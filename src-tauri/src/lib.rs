use std::fs::{self, File};
use std::io::{BufWriter, Read as IoRead};
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Local;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::GenericImageView;
use keyring::{Entry, Error as KeyringError};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

// macOS CoreWLAN/CoreLocation
#[cfg(target_os = "macos")]
use objc2_core_location::{CLAuthorizationStatus, CLLocationManager};
#[cfg(target_os = "macos")]
use objc2_core_wlan::CWWiFiClient;

// トレーアイコンのID
const TRAY_ID: &str = "main-tray";

// Keychain constants
const SERVICE: &str = "com.y-migita.pasha-log";
const ACCOUNT: &str = "VERCEL_API_KEY";

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_screen_recording_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 位置情報サービスの設定画面を開く
#[tauri::command]
fn open_location_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 位置情報権限の状態を確認
/// 返り値: "authorized", "denied", "notDetermined", "restricted", "unknown"
#[tauri::command]
fn check_location_permission() -> String {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            // 位置情報サービス自体が無効の場合
            if !CLLocationManager::locationServicesEnabled_class() {
                return "disabled".to_string();
            }

            let manager = CLLocationManager::new();
            let status = manager.authorizationStatus();

            match status {
                CLAuthorizationStatus::AuthorizedAlways => "authorized".to_string(),
                CLAuthorizationStatus::AuthorizedWhenInUse => "authorized".to_string(),
                CLAuthorizationStatus::Denied => "denied".to_string(),
                CLAuthorizationStatus::NotDetermined => "notDetermined".to_string(),
                CLAuthorizationStatus::Restricted => "restricted".to_string(),
                _ => "unknown".to_string(),
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        "unsupported".to_string()
    }
}

/// 位置情報権限を要求
/// macOSでは権限要求ダイアログが表示される
#[tauri::command]
fn request_location_permission() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            let manager = CLLocationManager::new();
            // macOSでは requestWhenInUseAuthorization を呼び出すとシステムダイアログが表示される
            manager.requestWhenInUseAuthorization();
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("この機能はmacOSでのみ利用可能です".to_string())
    }
}

/// ソースパスが許可されたディレクトリ内かどうかを検証する
/// 許可されるディレクトリ:
/// - システムの一時ディレクトリ (std::env::temp_dir)
/// - アプリのキャッシュディレクトリ (tauri-plugin-screenshots が使用する可能性あり)
fn validate_temp_path(source_path: &str) -> Result<PathBuf, String> {
    let source = PathBuf::from(source_path);

    // パスの存在確認
    if !source.exists() {
        return Err("ソースファイルが存在しません".to_string());
    }

    // 正規化してシンボリックリンク攻撃を防ぐ
    let canonical = source
        .canonicalize()
        .map_err(|e| format!("パスの正規化に失敗: {}", e))?;

    // 許可されるディレクトリのリストを構築
    let mut allowed_dirs: Vec<PathBuf> = Vec::new();

    // 1. システムの一時ディレクトリ
    let temp_dir = std::env::temp_dir();
    let canonical_temp_dir = temp_dir.canonicalize().unwrap_or(temp_dir);
    allowed_dirs.push(canonical_temp_dir);

    // 2. アプリのキャッシュディレクトリ (macOSでは ~/Library/Caches/com.y-migita.pasha-log)
    if let Some(cache_dir) = dirs::cache_dir() {
        let app_cache = cache_dir.join("com.y-migita.pasha-log");
        if let Ok(canonical_cache) = app_cache.canonicalize() {
            allowed_dirs.push(canonical_cache);
        }
    }

    // 3. macOSのApplication Supportディレクトリ内のキャッシュ
    if let Some(data_dir) = dirs::data_dir() {
        let app_data = data_dir.join("com.y-migita.pasha-log");
        if let Ok(canonical_data) = app_data.canonicalize() {
            allowed_dirs.push(canonical_data);
        }
    }

    // いずれかの許可されたディレクトリ内にあるかチェック
    let is_allowed = allowed_dirs.iter().any(|dir| canonical.starts_with(dir));
    if !is_allowed {
        return Err(format!(
            "許可されていないパスです: {}",
            canonical.display()
        ));
    }

    Ok(canonical)
}

/// 画像パスがアプリのPicturesフォルダ内かどうかを検証する
fn validate_pictures_path(image_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(image_path);

    // パスの存在確認
    if !path.exists() {
        return Err("画像ファイルが存在しません".to_string());
    }

    // 正規化してシンボリックリンク攻撃を防ぐ
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("パスの正規化に失敗: {}", e))?;

    // Picturesフォルダのパスを取得
    // app_dirも正規化してシンボリックリンクを解決（存在する場合のみ）
    let pictures_dir = dirs::picture_dir().ok_or("Picturesフォルダが見つかりません")?;
    let app_dir = pictures_dir.join("auto-daily-report");
    let canonical_app_dir = app_dir
        .canonicalize()
        .unwrap_or(app_dir);

    // アプリのPicturesフォルダ内のファイルのみ許可
    if !canonical.starts_with(&canonical_app_dir) {
        return Err("許可されていない画像パスです".to_string());
    }

    Ok(canonical)
}

/// スクリーンショット画像をリサイズ・JPEG圧縮してPicturesフォルダに保存（同期処理部分）
/// 重い画像処理を含むため、spawn_blockingで呼び出すこと
fn process_screenshot_blocking(source_path: String) -> Result<String, String> {
    // パスのバリデーション
    let validated_source = validate_temp_path(&source_path)?;

    // Picturesフォルダのパスを取得
    let pictures_dir = dirs::picture_dir().ok_or("Picturesフォルダが見つかりません")?;

    // アプリ用フォルダを作成
    let app_dir = pictures_dir.join("auto-daily-report");
    fs::create_dir_all(&app_dir).map_err(|e| format!("フォルダ作成エラー: {}", e))?;

    // 日付フォルダを作成 (YYYY-MM-DD)
    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let date_dir = app_dir.join(&date_str);
    fs::create_dir_all(&date_dir).map_err(|e| format!("日付フォルダ作成エラー: {}", e))?;

    // 日時を取得 (YYYYMMDD_HHMMSS)
    let datetime_str = now.format("%Y%m%d_%H%M%S").to_string();

    // 連番を探す（.jpg形式で）
    let mut counter = 1;
    let dest_path: PathBuf;
    loop {
        let filename = format!("{}_{:03}.jpg", datetime_str, counter);
        let candidate = date_dir.join(&filename);
        if !candidate.exists() {
            dest_path = candidate;
            break;
        }
        counter += 1;
        if counter > 999 {
            return Err("連番の上限に達しました".to_string());
        }
    }

    // 画像を読み込み
    let img = image::open(&validated_source).map_err(|e| format!("画像読み込みエラー: {}", e))?;

    // FHD（1920幅）にリサイズ（アスペクト比維持）
    let (width, height) = img.dimensions();
    let target_width = 1920u32;
    let resized = if width > target_width {
        let new_height = (height as f64 * target_width as f64 / width as f64) as u32;
        img.resize(target_width, new_height, FilterType::Lanczos3)
    } else {
        img
    };

    // JPEG品質80で保存
    let file = File::create(&dest_path).map_err(|e| format!("ファイル作成エラー: {}", e))?;
    let mut writer = BufWriter::new(file);
    let encoder = JpegEncoder::new_with_quality(&mut writer, 80);
    resized
        .write_with_encoder(encoder)
        .map_err(|e| format!("JPEG保存エラー: {}", e))?;

    // 元の一時ファイルを削除（失敗してもログを出力して続行）
    if let Err(e) = fs::remove_file(&validated_source) {
        eprintln!(
            "一時ファイルの削除に失敗しました: {} - {}",
            validated_source.display(),
            e
        );
    }

    // 新しいパスを返す
    dest_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or("パスの変換に失敗しました".to_string())
}

/// スクリーンショット画像をリサイズ・JPEG圧縮してPicturesフォルダに保存
/// source_path: screenshotsプラグインから取得した一時画像ファイルのパス
/// 非同期でバックグラウンドスレッドで実行し、UIスレッドをブロックしない
#[tauri::command]
async fn process_screenshot(source_path: String) -> Result<String, String> {
    // 重い画像処理をバックグラウンドスレッドで実行
    tauri::async_runtime::spawn_blocking(move || process_screenshot_blocking(source_path))
        .await
        .map_err(|e| format!("タスク実行エラー: {}", e))?
}

// ==================== Keychain Commands ====================

#[tauri::command]
fn set_vercel_api_key(api_key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    entry.set_password(&api_key).map_err(|e| e.to_string())
}

#[tauri::command]
fn has_vercel_api_key() -> Result<bool, String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_vercel_api_key() -> Result<(), String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn get_vercel_api_key() -> Result<String, String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

// ==================== Tray Icon Commands ====================

/// トレーアイコンのタイトルを更新（macOSではアイコンの横にテキスト表示）
#[tauri::command]
fn update_tray_title(app: AppHandle, title: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_title(Some(&title)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// トレーアイコンのタイトルをクリア
#[tauri::command]
fn clear_tray_title(app: AppHandle) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_title(None::<&str>).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// トレーアイコンのツールチップを更新
#[tauri::command]
fn update_tray_tooltip(app: AppHandle, tooltip: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_tooltip(Some(&tooltip))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ==================== Context Info (WiFi/Location) ====================

/// コンテキスト情報（WiFi SSID、位置情報）
#[derive(Default, Clone, serde::Serialize)]
struct ContextInfo {
    wifi_ssid: Option<String>,
    location: Option<LocationInfo>,
}

#[derive(Clone, serde::Serialize)]
struct LocationInfo {
    latitude: f64,
    longitude: f64,
}

/// 分析結果のJSON構造（画像と同じフォルダに保存）
#[derive(serde::Serialize)]
struct AnalysisResult {
    /// 分析日時（ISO 8601形式）
    timestamp: String,
    /// 使用したAIモデル
    model: String,
    /// コンテキスト情報
    context: ContextInfo,
    /// AI分析結果テキスト
    analysis: String,
}

/// 現在接続中のWiFi SSIDを取得（macOS）
/// 注意: macOS 14以降では位置情報サービスの許可が必要
#[cfg(target_os = "macos")]
fn get_wifi_ssid() -> Option<String> {
    unsafe {
        // CWWiFiClient.shared().interface()?.ssid()
        let client = CWWiFiClient::sharedWiFiClient();
        let interface = client.interface()?;
        let ssid = interface.ssid()?;
        // NSStringはDisplayトレイトを実装しているのでto_string()で変換
        Some(ssid.to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn get_wifi_ssid() -> Option<String> {
    None
}

/// 現在の位置情報を取得（macOS）
/// CoreLocationは非同期のデリゲートパターンが必要なため、
/// 同期的に取得するにはlocationServicesEnabledの確認と最後の既知位置を使用
/// 注意: 初回は位置情報がキャッシュされていない場合Noneを返す
#[cfg(target_os = "macos")]
fn get_location() -> Option<LocationInfo> {
    unsafe {
        // 位置情報サービスが有効か確認
        if !CLLocationManager::locationServicesEnabled_class() {
            return None;
        }

        let manager = CLLocationManager::new();

        // 認可状態を確認（macOS 11+）
        let status = manager.authorizationStatus();
        // AuthorizedAlways または AuthorizedWhenInUse で許可
        if status == CLAuthorizationStatus::AuthorizedAlways
            || status == CLAuthorizationStatus::AuthorizedWhenInUse
        {
            // 最後の既知位置を取得（利用可能な場合）
            // 注意: 他のアプリが位置情報を使用していないとキャッシュがない場合がある
            if let Some(location) = manager.location() {
                let coordinate = location.coordinate();
                return Some(LocationInfo {
                    latitude: coordinate.latitude,
                    longitude: coordinate.longitude,
                });
            }
        }
        None
    }
}

#[cfg(not(target_os = "macos"))]
fn get_location() -> Option<LocationInfo> {
    None
}

/// AI分析用のコンテキスト情報を収集
fn collect_context_info() -> ContextInfo {
    ContextInfo {
        wifi_ssid: get_wifi_ssid(),
        location: get_location(),
    }
}

/// コンテキスト情報をテキストに変換（AIプロンプト用）
fn format_context_info(info: &ContextInfo) -> String {
    let mut parts = Vec::new();

    if let Some(ref ssid) = info.wifi_ssid {
        parts.push(format!("接続WiFi: {}", ssid));
    }

    if let Some(ref loc) = info.location {
        parts.push(format!("位置: 緯度{:.6}, 経度{:.6}", loc.latitude, loc.longitude));
    }

    if parts.is_empty() {
        String::new()
    } else {
        format!("\n\n【追加コンテキスト】\n{}", parts.join("\n"))
    }
}

// ==================== Vercel AI Gateway (OpenAI-compatible) ====================

#[derive(serde::Deserialize)]
struct OpenAIResponse {
    choices: Option<Vec<OpenAIChoice>>,
    error: Option<OpenAIError>,
}

#[derive(serde::Deserialize)]
struct OpenAIChoice {
    message: OpenAIMessage,
}

#[derive(serde::Deserialize)]
struct OpenAIMessage {
    content: Option<String>,
}

#[derive(serde::Deserialize)]
struct OpenAIError {
    message: String,
}

/// 画像ファイルを読み込んでbase64エンコードする
fn image_to_base64(path: &str) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("ファイル読み込みエラー: {}", e))?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .map_err(|e| format!("ファイル読み込みエラー: {}", e))?;
    Ok(STANDARD.encode(buffer))
}

/// Vercel AI Gateway (OpenAI-compatible API)を呼び出してスクリーンショットを解析する
#[tauri::command]
async fn analyze_screenshot(
    image_path: String,
    model: String,
    prompt: String,
) -> Result<String, String> {
    // パスのバリデーション（Picturesフォルダ内のみ許可）
    let validated_path = validate_pictures_path(&image_path)?;

    // APIキーを取得
    let api_key = get_vercel_api_key()?;

    // コンテキスト情報を収集（WiFi SSID、位置情報）
    let context_info = collect_context_info();
    let context_text = format_context_info(&context_info);

    // プロンプトにコンテキスト情報を追加
    let full_prompt = format!("{}{}", prompt, context_text);

    // 画像をbase64エンコード（検証済みパスを使用）
    let image_base64 = image_to_base64(validated_path.to_str().ok_or("パス変換エラー")?)?;

    // MIMEタイプを判定
    let mime_type = if image_path.to_lowercase().ends_with(".png") {
        "image/png"
    } else {
        "image/jpeg"
    };

    // Vercel AI Gateway URL (OpenAI-compatible)
    let url = "https://ai-gateway.vercel.sh/v1/chat/completions";

    // OpenAI形式のリクエストボディ（vision対応）
    let body = serde_json::json!({
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": full_prompt
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": format!("data:{};base64,{}", mime_type, image_base64)
                    }
                }
            ]
        }],
        "max_tokens": 4096,
        "temperature": 0.2
    });

    // APIを呼び出し
    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API呼び出しエラー: {}", e))?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("レスポンス読み取りエラー: {}", e))?;

    if !status.is_success() {
        // ステータスコードのみを返し、レスポンスボディの詳細は含めない（機密情報漏洩防止）
        let error_hint = match status.as_u16() {
            401 => "認証エラー。APIキーを確認してください",
            403 => "アクセス拒否。APIキーの権限を確認してください",
            429 => "レート制限。しばらく待ってから再試行してください",
            500..=599 => "サーバーエラー。しばらく待ってから再試行してください",
            _ => "APIリクエストに失敗しました",
        };
        return Err(format!("API エラー ({}): {}", status.as_u16(), error_hint));
    }

    let openai_response: OpenAIResponse =
        serde_json::from_str(&response_text).map_err(|e| format!("JSONパースエラー: {}", e))?;

    // エラーチェック
    if let Some(error) = openai_response.error {
        return Err(format!("API エラー: {}", error.message));
    }

    // テキストを取得
    let text = openai_response
        .choices
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.message.content)
        .ok_or("AIからテキストが返されませんでした")?;

    // 分析結果をJSONファイルに保存（画像と同じフォルダ、同じファイル名で拡張子を.jsonに）
    let json_path = validated_path.with_extension("json");
    let analysis_result = AnalysisResult {
        timestamp: Local::now().to_rfc3339(),
        model: model.clone(),
        context: context_info,
        analysis: text.clone(),
    };
    let json_content = serde_json::to_string_pretty(&analysis_result)
        .map_err(|e| format!("JSONシリアライズエラー: {}", e))?;
    fs::write(&json_path, json_content)
        .map_err(|e| format!("JSON保存エラー: {}", e))?;

    Ok(text)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_screenshots::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            open_screen_recording_settings,
            open_location_settings,
            check_location_permission,
            request_location_permission,
            process_screenshot,
            set_vercel_api_key,
            has_vercel_api_key,
            delete_vercel_api_key,
            analyze_screenshot,
            update_tray_title,
            clear_tray_title,
            update_tray_tooltip
        ])
        .setup(|app| {
            // macOSでDockアイコンを非表示にしてメニューバーのみに表示
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // トレイメニューを作成
            let show = MenuItem::with_id(app, "show", "ウィンドウを表示", true, None::<&str>)?;
            let open_folder =
                MenuItem::with_id(app, "open_folder", "保存先を開く", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &open_folder, &quit])?;

            // システムトレイを作成（IDを指定してapp.tray_by_id()で取得可能に）
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "open_folder" => {
                        if let Some(pictures_dir) = dirs::picture_dir() {
                            let app_dir = pictures_dir.join("auto-daily-report");
                            // フォルダが存在しない場合は作成
                            let _ = fs::create_dir_all(&app_dir);
                            // Finderでフォルダを開く
                            let _ = std::process::Command::new("open").arg(&app_dir).spawn();
                        }
                    }
                    "quit" => {
                        let confirmed = app
                            .dialog()
                            .message("アプリケーションを終了しますか？")
                            .title("終了確認")
                            .kind(MessageDialogKind::Warning)
                            .buttons(MessageDialogButtons::OkCancelCustom(
                                "終了".to_string(),
                                "キャンセル".to_string(),
                            ))
                            .blocking_show();
                        if confirmed {
                            app.exit(0);
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // ウィンドウを閉じるときは非表示にするだけでアプリは終了しない
            // 注意: prevent_close()を先に呼ぶことで、hide()が完了する前に
            // アプリが終了することを防ぐ
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Command+Q などでアプリ終了が要求されたときもウィンドウを非表示にするだけ
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
                // すべてのウィンドウを非表示にする
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
        });
}
