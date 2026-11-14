from dataclasses import dataclass


@dataclass(frozen=True)
class HostingService:
    domain: str
    name: str
    owner_noun: str
    suggested_owner: str | None = None

    def to_json(self) -> dict:
        return {
            "domain": self.domain,
            "name": self.name,
            "owner_noun": self.owner_noun,
            "suggested_owner": self.suggested_owner,
        }


@dataclass(frozen=True)
class Owner:
    slug: str
    name: str

    def to_json(self) -> dict:
        return {"slug": self.slug, "name": self.name}


@dataclass(frozen=True)
class Repository:
    host: str
    owner: str
    slug: str
    description: str
    private: bool

    @property
    def key(self) -> str:
        return f"{self.host}/{self.owner}/{self.slug}".lower()

    def to_json(self) -> dict:
        return {
            "key": self.key,
            "host": self.host,
            "owner": self.owner,
            "slug": self.slug,
            "description": self.description,
            "private": self.private,
        }
