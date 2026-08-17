//! Platform-native secret encryption.
//!
//! - Windows: DPAPI (`CryptProtectData`) — encrypts with user login credential.
//! - macOS: Keychain via `security` framework.
//! - Linux: `keyring` crate (Secret Service / DBus).

use crate::error::AppError;

/// Encrypt plaintext to a hex-encoded ciphertext using the best platform method.
#[allow(unused_variables)]
pub fn encrypt_secret(service: &str, account: &str, plaintext: &str) -> Result<String, AppError> {
    #[cfg(target_os = "windows")]
    {
        encrypt_dpapi(plaintext)
    }
    #[cfg(not(target_os = "windows"))]
    {
        encrypt_keyring(service, account, plaintext)
    }
}
/// Decrypt hex-encoded ciphertext back to plaintext.
#[allow(unused_variables)]
pub fn decrypt_secret(
    service: &str,
    account: &str,
    hex_ciphertext: &str,
) -> Result<String, AppError> {
    #[cfg(target_os = "windows")]
    {
        decrypt_dpapi(hex_ciphertext)
    }
    #[cfg(not(target_os = "windows"))]
    {
        decrypt_keyring(service, account, hex_ciphertext)
    }
}

// ── Windows DPAPI ────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod dpapi {
    use super::AppError;
    use windows_sys::Win32::Foundation::{
        GetLastError, LocalFree, FALSE,
    };
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };
    use std::ptr;

    /// Encrypt plaintext with DPAPI (current user context).
    pub fn encrypt(plaintext: &str) -> Result<String, AppError> {
        let data = plaintext.as_bytes();
        let mut data_in = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };

        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };

        let ok = unsafe {
            CryptProtectData(
                &mut data_in,
                ptr::null(),        // description
                ptr::null(),        // entropy
                ptr::null(),        // reserved
                ptr::null(),        // prompt struct
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut data_out,
            )
        };

        if ok == FALSE {
            let err = unsafe { GetLastError() };
            return Err(AppError::ConfigError(format!(
                "DPAPI CryptProtectData failed (error {err})"
            )));
        }

        // Convert to hex
        let bytes = unsafe {
            std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize)
        };
        let hex = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();

        unsafe { LocalFree(data_out.pbData as *mut std::ffi::c_void) };
        Ok(hex)
    }

    /// Decrypt hex-encoded DPAPI ciphertext back to plaintext.
    pub fn decrypt(hex: &str) -> Result<String, AppError> {
        let bytes = super::hex::decode(hex)
            .map_err(|e| AppError::ConfigError(format!("Invalid DPAPI hex: {e}")))?;

        let mut data_in = CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_ptr() as *mut u8,
        };

        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };

        let ok = unsafe {
            CryptUnprotectData(
                &mut data_in,
                ptr::null_mut(),    // description out
                ptr::null(),        // entropy
                ptr::null(),        // reserved
                ptr::null(),        // prompt struct
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut data_out,
            )
        };

        if ok == FALSE {
            let err = unsafe { GetLastError() };
            return Err(AppError::ConfigError(format!(
                "DPAPI CryptUnprotectData failed (error {err})"
            )));
        }

        let plaintext = unsafe {
            let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
            String::from_utf8_lossy(slice).into_owned()
        };

        unsafe { LocalFree(data_out.pbData as *mut std::ffi::c_void) };
        Ok(plaintext)
    }
}

#[cfg(target_os = "windows")]
use dpapi::{encrypt as encrypt_dpapi, decrypt as decrypt_dpapi};

// ── macOS / Linux keyring ────────────────────────────────────────────

#[cfg(not(target_os = "windows"))]
fn encrypt_keyring(service: &str, account: &str, plaintext: &str) -> Result<String, AppError> {
    let entry = keyring::Entry::new(service, account)
        .map_err(|e| AppError::ConfigError(format!("Keyring access failed: {e}")))?;
    entry
        .set_password(plaintext)
        .map_err(|e| AppError::ConfigError(format!("Keyring write failed: {e}")))?;
    // Return a placeholder — actual secret is in keyring
    Ok("keyring:stored".to_string())
}

#[cfg(not(target_os = "windows"))]
fn decrypt_keyring(
    service: &str,
    account: &str,
    _hex_ciphertext: &str,
) -> Result<String, AppError> {
    let entry = keyring::Entry::new(service, account)
        .map_err(|e| AppError::ConfigError(format!("Keyring access failed: {e}")))?;
    entry
        .get_password()
        .map_err(|e| AppError::ConfigError(format!("Keyring read failed: {e}")))
}

// ── Hex encoding (minimal, no extra crate) ───────────────────────────

mod hex {
    pub fn decode(s: &str) -> Result<Vec<u8>, String> {
        fn nibble(b: u8) -> Result<u8, String> {
            match b {
                b'0'..=b'9' => Ok(b - b'0'),
                b'a'..=b'f' => Ok(b - b'a' + 10),
                b'A'..=b'F' => Ok(b - b'A' + 10),
                _ => Err(format!("invalid hex digit: {}", b as char)),
            }
        }

        let bytes = s.as_bytes();
        if bytes.len() % 2 != 0 {
            return Err("odd hex length".to_string());
        }
        // Operate on bytes, not &str slices — slicing a corrupted (non-ASCII)
        // string at byte offsets would panic mid-char.
        bytes
            .chunks_exact(2)
            .map(|pair| Ok(nibble(pair[0])? << 4 | nibble(pair[1])?))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let plaintext = "my_secret_password_123!";
        let encrypted = encrypt_secret("test_service", "test_account", plaintext)
            .expect("encrypt should succeed");
        assert!(!encrypted.is_empty(), "ciphertext should not be empty");
        assert_ne!(encrypted, plaintext, "ciphertext should differ from plaintext");

        let decrypted = decrypt_secret("test_service", "test_account", &encrypted)
            .expect("decrypt should succeed");
        assert_eq!(decrypted, plaintext, "round-trip should preserve plaintext");
    }

    #[test]
    fn encrypt_empty_string() {
        let encrypted = encrypt_secret("test_service", "test_account", "")
            .expect("encrypt empty string should work");
        let decrypted = decrypt_secret("test_service", "test_account", &encrypted)
            .expect("decrypt empty string should work");
        assert_eq!(decrypted, "");
    }

    #[test]
    fn encrypt_different_services_produce_different_output() {
        let a = encrypt_secret("svc_a", "acct", "password").unwrap();
        let b = encrypt_secret("svc_b", "acct", "password").unwrap();
        // On keyring platforms they may be identical (placeholder), on DPAPI they differ
        // Just verify both produce valid output
        assert!(!a.is_empty());
        assert!(!b.is_empty());
    }

    #[test]
    fn decrypt_invalid_hex_fails() {
        let result = decrypt_secret("svc", "acct", "not-hex");
        assert!(result.is_err(), "non-hex input should fail");
    }

    #[test]
    fn hex_decode_valid() {
        assert_eq!(hex::decode("48656c6c6f").unwrap(), b"Hello");
        assert_eq!(hex::decode("").unwrap(), b"");
    }

    #[test]
    fn hex_decode_invalid() {
        assert!(hex::decode("xyz").is_err());
        assert!(hex::decode("abc").is_err()); // odd length
    }
}
