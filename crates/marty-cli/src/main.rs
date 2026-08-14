mod commands;
mod config;
mod license;
mod output;

use clap::Parser;

#[tokio::main]
async fn main() {
    if matches!(std::env::args().nth(1).as_deref(), Some("--version" | "-V")) {
        println!(env!("CARGO_PKG_VERSION"));
        return;
    }
    let cli = commands::Cli::parse();
    if let Err(error) = commands::run(cli).await {
        if commands::should_print_error(&error) {
            eprintln!("error: {error}");
        }
        std::process::exit(commands::exit_code(&error));
    }
}
