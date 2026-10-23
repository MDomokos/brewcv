use std::{path::Path, time::Duration};

// Prints the calling window's page to a PDF file, no print panel (macOS). Resolves when the file has stopped growing.
// Async so it runs off the main thread, which with_webview needs free.
#[tauri::command]
async fn print_pdf(window: tauri::WebviewWindow, path: String, width: f64, height: f64) -> Result<(), String> {
    // a file left from before would look like the finished one
    let _ = std::fs::remove_file(&path);
    start_print(&window, &path, width, height)?;
    wait_for_file(Path::new(&path)).await
}

async fn wait_for_file(path: &Path) -> Result<(), String> {
    let mut last = 0;
    for _ in 0..40 {
        sleep_ms(500).await;
        let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        if len > 0 && len == last {
            return Ok(());
        }
        last = len;
    }
    Err("the PDF file did not appear".into())
}

async fn sleep_ms(ms: u64) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(Duration::from_millis(ms))).await;
}

#[cfg(target_os = "macos")]
fn start_print(window: &tauri::WebviewWindow, path: &str, width: f64, height: f64) -> Result<(), String> {
    use objc2::{msg_send, rc::Retained, runtime::AnyObject};
    use objc2_app_kit::{NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob};
    use objc2_foundation::{NSSize, NSString, NSURL};

    let path = path.to_owned();
    window
        .with_webview(move |wv| unsafe {
            let web_view: &AnyObject = &*(wv.inner() as *const AnyObject);
            let shared = NSPrintInfo::sharedPrintInfo();
            let info: Retained<NSPrintInfo> = msg_send![&*shared, copy];
            info.setPaperSize(NSSize { width, height }); // the page box of the resume's format, in points
            info.setTopMargin(0.0);
            info.setBottomMargin(0.0);
            info.setLeftMargin(0.0);
            info.setRightMargin(0.0);
            info.setJobDisposition(NSPrintSaveJob);
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
            let _: () = msg_send![&*info.dictionary(), setObject: &*url, forKey: NSPrintJobSavingURL];
            let op: Retained<NSPrintOperation> = msg_send![web_view, printOperationWithPrintInfo: &*info];
            op.setShowsPrintPanel(false);
            op.setShowsProgressPanel(false);
            // Modal-for-window only. Plain runOperation blocks the main thread, freezes the app and wrote a runaway file.
            let win: *mut AnyObject = msg_send![web_view, window];
            let nil: *mut AnyObject = std::ptr::null_mut();
            let _: () = msg_send![&*op, runOperationModalForWindow: win, delegate: nil, didRunSelector: nil as *const std::ffi::c_void, contextInfo: nil];
        })
        .map_err(|e| e.to_string())
}

// WebKitGTK prints straight to a file, no dialog: the paper is the format's and the margins are none, so nothing is drawn round the page (the
// footer with a name and a page number came from the print dialog's own settings).
#[cfg(target_os = "linux")]
fn start_print(window: &tauri::WebviewWindow, path: &str, width: f64, height: f64) -> Result<(), String> {
    use gtk::{glib, PageSetup, PaperSize, PrintSettings, Unit};
    use webkit2gtk::{PrintOperation, PrintOperationExt};

    let uri = glib::filename_to_uri(path, None).map_err(|e| e.to_string())?;
    window
        .with_webview(move |wv| {
            let setup = PageSetup::new();
            setup.set_paper_size(&PaperSize::new_custom("brewcv", "BrewCV", width, height, Unit::Points));
            setup.set_top_margin(0.0, Unit::Points);
            setup.set_bottom_margin(0.0, Unit::Points);
            setup.set_left_margin(0.0, Unit::Points);
            setup.set_right_margin(0.0, Unit::Points);
            let settings = PrintSettings::new();
            settings.set_printer("Print to File");
            settings.set(&gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
            settings.set(&gtk::PRINT_SETTINGS_OUTPUT_URI, Some(uri.as_str()));
            let op = PrintOperation::new(&wv.inner());
            op.set_page_setup(&setup);
            op.set_print_settings(&settings);
            op.print();
        })
        .map_err(|e| e.to_string())
}

// The page falls back to the browser's print dialog on this error.
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn start_print(_window: &tauri::WebviewWindow, _path: &str, _width: f64, _height: f64) -> Result<(), String> {
    Err("unsupported".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())   // after fs: it restores the folders the person picked
        .invoke_handler(tauri::generate_handler![print_pdf])
        .run(tauri::generate_context!())
        .expect("error while running BrewCV");
}
