use std::fs::{self, File};
use std::io::BufWriter;
use std::path::PathBuf;

use chrono::Local;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::GenericImageView;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

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

#[tauri::command]
fn save_screenshot_to_pictures(source_path: &str) -> Result<String, String> {
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

    // 連番を探す
    let mut counter = 1;
    let dest_path: PathBuf;
    loop {
        let filename = format!("screenshot_{}_{:03}.png", time_str, counter);
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

    // ファイルをコピー
    fs::copy(source_path, &dest_path).map_err(|e| format!("ファイルコピーエラー: {}", e))?;

    // 新しいパスを返す
    dest_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or("パスの変換に失敗しました".to_string())
}

/// スクリーンショット画像をリサイズ・JPEG圧縮してPicturesフォルダに保存
/// source_path: screenshotsプラグインから取得した一時画像ファイルのパス
#[tauri::command]
fn process_screenshot(source_path: &str) -> Result<String, String> {
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
    let img = image::open(source_path).map_err(|e| format!("画像読み込みエラー: {}", e))?;

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
    let writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(writer, 80);
    encoder
        .encode_image(&resized)
        .map_err(|e| format!("JPEG保存エラー: {}", e))?;

    // 元の一時ファイルを削除（エラーは無視）
    let _ = fs::remove_file(source_path);

    // 新しいパスを返す
    dest_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or("パスの変換に失敗しました".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_screenshots::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            open_screen_recording_settings,
            save_screenshot_to_pictures,
            process_screenshot
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
