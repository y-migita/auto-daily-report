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
    Manager,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

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

/// ソースパスが一時ディレクトリ内かどうかを検証する
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

    // 一時ディレクトリ内のファイルのみ許可
    let temp_dir = std::env::temp_dir();
    if !canonical.starts_with(&temp_dir) {
        return Err("許可されていないパスです".to_string());
    }

    Ok(canonical)
}

/// スクリーンショット画像をリサイズ・JPEG圧縮してPicturesフォルダに保存
/// source_path: screenshotsプラグインから取得した一時画像ファイルのパス
#[tauri::command]
fn process_screenshot(source_path: &str) -> Result<String, String> {
    // パスのバリデーション
    let validated_source = validate_temp_path(source_path)?;

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

    // 時刻を取得 (HH-MM-SS)
    let time_str = now.format("%H-%M-%S").to_string();

    // 連番を探す（.jpg形式で）
    let mut counter = 1;
    let dest_path: PathBuf;
    loop {
        let filename = format!("screenshot_{}_{:03}.jpg", time_str, counter);
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
        eprintln!("一時ファイルの削除に失敗しました: {} - {}", validated_source.display(), e);
    }

    // 新しいパスを返す
    dest_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or("パスの変換に失敗しました".to_string())
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
async fn analyze_screenshot(image_path: String, model: String, prompt: String) -> Result<String, String> {
    // APIキーを取得
    let api_key = get_vercel_api_key()?;

    // 画像をbase64エンコード
    let image_base64 = image_to_base64(&image_path)?;

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
                    "text": prompt
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": format!("data:{};base64,{}", mime_type, image_base64)
                    }
                }
            ]
        }],
        "max_tokens": 1024,
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
            process_screenshot,
            set_vercel_api_key,
            has_vercel_api_key,
            delete_vercel_api_key,
            analyze_screenshot
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

            // システムトレイを作成
            TrayIconBuilder::new()
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
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
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
