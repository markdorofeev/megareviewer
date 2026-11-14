from pathlib import Path
from unittest.mock import patch

import numpy as np

from delphi_code.domain.diagnostics import Diagnostics
from delphi_code.domain.errors import Failure, FailureKind
from delphi_code.domain.hosting_services import HostingService, TokenForm
from delphi_code.domain.index_state import IndexCounts
from delphi_code.domain.indexing_outcomes import IndexingOutcome
from delphi_code.domain.manifest import IndexedRevision
from delphi_code.infrastructure.model import LocalModel
from delphi_code.infrastructure.registry import Registry
from delphi_code.infrastructure.store import Store
from delphi_code.services.application import DelphiCode


class FakeModel:
    def __init__(self, directory: Path, sha256: str = "same-model", vector=(1, 0)):
        self.directory = directory
        self.sha256 = sha256
        self.vector = vector
        self.embedded: list[list[str]] = []

    @property
    def dimensions(self):
        return len(self.vector)

    def embed(self, texts):
        self.embedded.append(texts)
        return np.array([self.vector] * len(texts), dtype=np.float32)


def use_fake_model(test_case, directory: Path, **options) -> FakeModel:
    model = FakeModel(directory, **options)
    test_case.enterContext(patch.object(LocalModel, "inspect", return_value=model))
    return model


def indexing_outcome(key: str, index_directory: str, project: str | None = None, **revision) -> IndexingOutcome:
    return IndexingOutcome(project, key, index_directory, IndexedRevision(**revision), IndexCounts(0, 0), 0, None)


def diagnostics(model: str = "/models/m") -> Diagnostics:
    return Diagnostics(
        version="0.0.0",
        project=None,
        key="local:/work",
        index_directory=None,
        model=model,
        model_sha256="same-model",
        dimensions=2,
        self_distance=0.0,
        device="cpu",
        cocoindex_storage="ok",
        offline=True,
        network_guard="python_audit",
        sqlite="3",
        dependencies={},
    )


def application(model_location: str = "/models/m", repository_hosts=None) -> DelphiCode:
    find_hosts = None if repository_hosts is None else (lambda: repository_hosts)
    return DelphiCode(model_location, Store(), Registry(), find_hosts)


class FakeHost:
    owner_noun = "workspace"
    credentials_hint = "set FAKE_TOKEN"
    valid_token = "valid-token"
    rejected_token_hint = "Check the token"

    def __init__(
        self,
        owners,
        repositories,
        name="Bitbucket",
        suggested_owner=None,
        credentials_source="FAKE_TOKEN from the environment",
        account="me",
        username_label=None,
    ):
        self._owners, self._repositories, self.name = owners, repositories, name
        self.domain = f"{name.lower()}.example"
        self._suggested_owner = suggested_owner
        self.credentials_source, self._account = credentials_source, account
        self.token_form = TokenForm(f"https://{self.domain}/tokens", "read access", username_label)
        self.saved_token = None

    @property
    def has_saved_token(self):
        return self.saved_token is not None

    def with_token(self, token, username=None):
        rejected = Failure("remote_auth_failed", "401", FailureKind.REMOTE_FAILED)
        return FakeHost([], [], self.name, account=self._account if token == self.valid_token else rejected)

    def save_token(self, token, username=None):
        self.saved_token = (token, username)
        self.credentials_source = "token saved by Delphi Code"

    def forget_saved_token(self):
        self.saved_token = None
        self.credentials_source = None

    def has_api_credentials(self):
        return self.credentials_source is not None

    def account(self):
        if isinstance(self._account, Failure):
            raise self._account
        return self._account

    def description(self):
        return HostingService(self.domain, self.name, self.owner_noun, self._suggested_owner)

    def owners(self):
        if isinstance(self._owners, Failure):
            raise self._owners
        return self._owners

    def suggested_owner(self):
        return self._suggested_owner

    def repositories(self, owner):
        return [repository for repository in self._repositories if repository.owner == owner]
