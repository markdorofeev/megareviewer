import shutil
import subprocess
import sys

from ..domain.errors import Failure, FailureKind

KEYCHAIN_SERVICE = "delphi-code"
KEYCHAIN_TIMEOUT_SECONDS = 30
KEYCHAIN_MISSING_MESSAGE = (
    "Saving a token needs the macOS keychain or secret-tool from libsecret; "
    "set the token in the environment before starting delphi-code instead"
)


def saved_secret(account: str) -> str | None:
    if _uses_macos_keychain():
        found = _run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"])
    elif shutil.which("secret-tool"):
        found = _run(["secret-tool", "lookup", "service", KEYCHAIN_SERVICE, "account", account])
    else:
        return None
    if found is None or found.returncode != 0:
        return None
    return found.stdout.strip() or None


def save_secret(account: str, label: str, secret: str):
    if _uses_macos_keychain():
        # security -i reads the command from stdin, so the secret never appears in a process listing
        command = (
            f'add-generic-password -U -s {KEYCHAIN_SERVICE} -a {account} -l "{label}" -X {secret.encode().hex()}\n'
        )
        _run(["security", "-i"], command)
    elif shutil.which("secret-tool"):
        _run(["secret-tool", "store", f"--label={label}", "service", KEYCHAIN_SERVICE, "account", account], secret)
    else:
        raise Failure("keychain_missing", KEYCHAIN_MISSING_MESSAGE, FailureKind.PREREQUISITE_MISSING)
    if saved_secret(account) != secret:
        raise Failure(
            "keychain_failed", f"The keychain did not keep the token for {account}", FailureKind.OPERATION_FAILED
        )


def forget_secret(account: str):
    if _uses_macos_keychain():
        _run(["security", "delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account])
    elif shutil.which("secret-tool"):
        _run(["secret-tool", "clear", "service", KEYCHAIN_SERVICE, "account", account])


def _uses_macos_keychain() -> bool:
    return sys.platform == "darwin" and shutil.which("security") is not None


def _run(command: list[str], stdin: str | None = None) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(command, input=stdin, capture_output=True, text=True, timeout=KEYCHAIN_TIMEOUT_SECONDS)
    except (OSError, subprocess.TimeoutExpired):
        return None
