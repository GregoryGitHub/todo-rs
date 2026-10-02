//! Senhas e tokens das conexões no cofre do sistema (Windows Credential Manager,
//! Keychain no macOS, Secret Service no Linux). Nunca vão para `databases.json`.

use keyring::Entry;

const SERVICE: &str = "todo-rs";

/// "password" (login SQL) | "entra" (refresh token do Microsoft Entra)
fn entry(conn_id: &str, kind: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, &format!("db:{conn_id}:{kind}")).map_err(|e| format!("Cofre de senhas indisponível: {e}"))
}

pub fn get(conn_id: &str, kind: &str) -> Result<Option<String>, String> {
    match entry(conn_id, kind)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Falha ao ler o cofre de senhas: {e}")),
    }
}

pub fn set(conn_id: &str, kind: &str, value: &str) -> Result<(), String> {
    entry(conn_id, kind)?
        .set_password(value)
        .map_err(|e| format!("Falha ao gravar no cofre de senhas: {e}"))
}

pub fn delete(conn_id: &str, kind: &str) -> Result<(), String> {
    match entry(conn_id, kind)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Falha ao apagar do cofre de senhas: {e}")),
    }
}
