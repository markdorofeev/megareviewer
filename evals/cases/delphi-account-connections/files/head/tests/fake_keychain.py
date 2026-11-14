import json
import os
from pathlib import Path
import shlex
import sys

NOT_FOUND = 44


def main(tool, arguments):
    store = Path(os.environ["FAKE_KEYCHAIN"])
    secrets = json.loads(store.read_text()) if store.exists() else {}
    if tool == "security" and arguments == ["-i"]:
        tool, arguments = "security", shlex.split(sys.stdin.read())
    command, options = arguments[0], arguments[1:]
    if tool == "security":
        account = options[options.index("-a") + 1]
        secret = bytes.fromhex(options[options.index("-X") + 1]).decode() if "-X" in options else None
    else:
        account = options[options.index("account") + 1]
        secret = sys.stdin.read() if command == "store" else None
    if command in ("add-generic-password", "store"):
        secrets[account] = secret
    elif command in ("delete-generic-password", "clear"):
        secrets.pop(account, None)
    elif account in secrets:
        print(secrets[account])
    else:
        return NOT_FOUND
    store.write_text(json.dumps(secrets))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1], sys.argv[2:]))
