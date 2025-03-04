# Please do not use
#     from __future__ import annotations
# in modules such as this one where hybrid cloud service classes and data models are
# defined, because we want to reflect on type annotations and avoid forward references.

from abc import abstractmethod
from typing import Any, Iterable, List, Mapping, Optional, cast

from pydantic import Field

from sentry.models.organization import OrganizationStatus
from sentry.models.organizationmember import InviteStatus
from sentry.roles import team_roles
from sentry.roles.manager import TeamRole
from sentry.services.hybrid_cloud import RpcModel
from sentry.services.hybrid_cloud.region import (
    ByOrganizationId,
    ByOrganizationIdAttribute,
    ByOrganizationSlug,
    UnimplementedRegionResolution,
)
from sentry.services.hybrid_cloud.rpc import RpcService, regional_rpc_method
from sentry.silo import SiloMode


def team_status_visible() -> int:
    from sentry.models import TeamStatus

    return int(TeamStatus.VISIBLE)


class RpcTeam(RpcModel):
    id: int = -1
    status: int = Field(default_factory=team_status_visible)
    organization_id: int = -1
    slug: str = ""
    actor_id: Optional[int] = None
    org_role: Optional[str] = None

    def class_name(self) -> str:
        return "Team"


class RpcTeamMember(RpcModel):
    id: int = -1
    is_active: bool = False
    role_id: str = ""
    project_ids: List[int] = Field(default_factory=list)
    scopes: List[str] = Field(default_factory=list)
    team_id: int = -1

    @property
    def role(self) -> Optional[TeamRole]:
        return team_roles.get(self.role_id) if self.role_id else None


def project_status_visible() -> int:
    from sentry.models import ProjectStatus

    return int(ProjectStatus.VISIBLE)


class RpcProject(RpcModel):
    id: int = -1
    slug: str = ""
    name: str = ""
    organization_id: int = -1
    status: int = Field(default_factory=project_status_visible)


class RpcOrganizationMemberFlags(RpcModel):
    sso__linked: bool = False
    sso__invalid: bool = False
    member_limit__restricted: bool = False

    def __getattr__(self, item: str) -> bool:
        from sentry.services.hybrid_cloud.organization.impl import escape_flag_name

        item = escape_flag_name(item)
        return bool(getattr(self, item))

    def __getitem__(self, item: str) -> bool:
        return bool(getattr(self, item))


class RpcOrganizationMemberSummary(RpcModel):
    id: int = -1
    organization_id: int = -1
    user_id: Optional[int] = None  # This can be null when the user is deleted.
    flags: RpcOrganizationMemberFlags = Field(default_factory=lambda: RpcOrganizationMemberFlags())


class RpcOrganizationMember(RpcOrganizationMemberSummary):
    member_teams: List[RpcTeamMember] = Field(default_factory=list)
    role: str = ""
    has_global_access: bool = False
    project_ids: List[int] = Field(default_factory=list)
    scopes: List[str] = Field(default_factory=list)
    invite_status: int = InviteStatus.APPROVED.value

    def get_audit_log_metadata(self, user_email: str) -> Mapping[str, Any]:
        team_ids = [mt.team_id for mt in self.member_teams]

        return {
            "email": user_email,
            "teams": team_ids,
            "has_global_access": self.has_global_access,
            "role": self.role,
            "invite_status": self.invite_status,
        }


class RpcOrganizationFlags(RpcModel):
    allow_joinleave: bool = False
    enhanced_privacy: bool = False
    disable_shared_issues: bool = False
    early_adopter: bool = False
    require_2fa: bool = False
    disable_new_visibility_features: bool = False
    require_email_verification: bool = False


class RpcOrganizationInvite(RpcModel):
    id: int = -1
    token: str = ""
    email: str = ""


class RpcOrganizationSummary(RpcModel):
    """
    The subset of organization metadata available from the control silo specifically.
    """

    slug: str = ""
    id: int = -1
    name: str = ""

    def __hash__(self) -> int:
        # Mimic the behavior of hashing a Django ORM entity, for compatibility with
        # serializers, as this organization summary object is often used for that.
        return hash((self.id, self.slug))


class RpcOrganization(RpcOrganizationSummary):
    # Represents the full set of teams and projects associated with the org.  Note that these are not filtered by
    # visibility, but you can apply a manual filter on the status attribute.
    teams: List[RpcTeam] = Field(default_factory=list)
    projects: List[RpcProject] = Field(default_factory=list)

    flags: RpcOrganizationFlags = Field(default_factory=lambda: RpcOrganizationFlags())
    status: OrganizationStatus = OrganizationStatus.VISIBLE

    default_role: str = ""


class RpcUserOrganizationContext(RpcModel):
    """
    This object wraps an organization result inside of its membership context in terms of an (optional) user id.
    This is due to the large number of callsites that require an organization and a user's membership at the
    same time and in a consistency state.  This object allows a nice envelop for both of these ideas from a single
    transactional query.  Used by access, determine_active_organization, and others.
    """

    # user_id is None iff the get_organization_by_id call is not provided a user_id context.
    user_id: Optional[int] = None
    # The organization is always non-null because the null wrapping is around this object instead.
    # A None organization => a None RpcUserOrganizationContext
    organization: RpcOrganization = Field(default_factory=lambda: RpcOrganization())
    # member can be None when the given user_id does not have membership with the given organization.
    # Note that all related fields of this organization member are filtered by visibility and is_active=True.
    member: Optional[RpcOrganizationMember] = None

    def __post_init__(self) -> None:
        # Ensures that outer user_id always agrees with the inner member object.
        if self.user_id is not None and self.member is not None:
            assert self.user_id == self.member.user_id


class OrganizationService(RpcService):
    key = "organization"
    local_mode = SiloMode.REGION

    @classmethod
    def get_local_implementation(cls) -> RpcService:
        from sentry.services.hybrid_cloud.organization.impl import DatabaseBackedOrganizationService

        return DatabaseBackedOrganizationService()

    @regional_rpc_method(resolve=ByOrganizationId("id"))
    @abstractmethod
    def get_organization_by_id(
        self, *, id: int, user_id: Optional[int] = None, slug: Optional[str] = None
    ) -> Optional[RpcUserOrganizationContext]:
        """
        Fetches the organization, team, and project data given by an organization id, regardless of its visibility
        status.  When user_id is provided, membership data related to that user from the organization
        is also given in the response.  See RpcUserOrganizationContext for more info.
        """
        pass

    @regional_rpc_method(resolve=ByOrganizationSlug())
    @abstractmethod
    def get_org_by_slug(
        self,
        *,
        slug: str,
        user_id: Optional[int] = None,
    ) -> Optional[RpcOrganizationSummary]:
        """
        Fetches the organization, by an organization slug. If user_id is passed, it will enforce visibility
        rules. This method is differentiated from get_organization_by_slug by not being cached and returning
        RpcOrganizationSummary instead of org contexts
        """
        pass

    # TODO: This should return RpcOrganizationSummary objects, since we cannot realistically span out requests and
    #  capture full org objects / teams / permissions.  But we can gather basic summary data from the control silo.
    @regional_rpc_method(resolve=UnimplementedRegionResolution())
    @abstractmethod
    def get_organizations(
        self,
        *,
        user_id: Optional[int],
        scope: Optional[str],
        only_visible: bool,
        organization_ids: Optional[List[int]] = None,
    ) -> List[RpcOrganizationSummary]:
        """
        When user_id is set, returns all organizations associated with that user id given
        a scope and visibility requirement.  When user_id is not set, but organization_ids is, provides the
        set of organizations matching those ids, ignore scope and user_id.

        When only_visible set, the organization object is only returned if it's status is Visible, otherwise any
        organization will be returned.

        Because this endpoint fetches not from region silos, but the control silo organization membership table,
        only a subset of all organization metadata is available.  Spanning out and querying multiple organizations
        for their full metadata is greatly discouraged for performance reasons.
        """
        pass

    @regional_rpc_method(resolve=ByOrganizationId())
    @abstractmethod
    def check_membership_by_email(
        self, *, organization_id: int, email: str
    ) -> Optional[RpcOrganizationMember]:
        """
        Used to look up an organization membership by an email
        """
        pass

    @regional_rpc_method(resolve=ByOrganizationId())
    @abstractmethod
    def check_membership_by_id(
        self, *, organization_id: int, user_id: int
    ) -> Optional[RpcOrganizationMember]:
        """
        Used to look up an organization membership by a user id
        """
        pass

    @regional_rpc_method(resolve=ByOrganizationSlug())
    @abstractmethod
    def check_organization_by_slug(self, *, slug: str, only_visible: bool) -> Optional[int]:
        """
        If exists and matches the only_visible requirement, returns an organization's id by the slug.
        """
        pass

    def get_organization_by_slug(
        self, *, user_id: Optional[int], slug: str, only_visible: bool
    ) -> Optional[RpcUserOrganizationContext]:
        """
        Defers to check_organization_by_slug -> get_organization_by_id
        """
        org_id = self.check_organization_by_slug(slug=slug, only_visible=only_visible)
        if org_id is None:
            return None

        return self.get_organization_by_id(id=org_id, user_id=user_id)

    @regional_rpc_method(resolve=ByOrganizationId())
    @abstractmethod
    def add_organization_member(
        self,
        *,
        organization_id: int,
        default_org_role: str,
        user_id: Optional[int] = None,
        email: Optional[str] = None,
        flags: Optional[RpcOrganizationMemberFlags] = None,
        role: Optional[str] = None,
        inviter_id: Optional[int] = None,
        invite_status: Optional[int] = InviteStatus.APPROVED.value,
    ) -> RpcOrganizationMember:
        pass

    @regional_rpc_method(resolve=ByOrganizationIdAttribute("organization_member"))
    @abstractmethod
    def add_team_member(self, *, team_id: int, organization_member: RpcOrganizationMember) -> None:
        pass

    @regional_rpc_method(resolve=UnimplementedRegionResolution())
    @abstractmethod
    def get_team_members(self, *, team_id: int) -> Iterable[RpcOrganizationMember]:
        pass

    @regional_rpc_method(resolve=ByOrganizationIdAttribute("organization_member"))
    @abstractmethod
    def update_membership_flags(self, *, organization_member: RpcOrganizationMember) -> None:
        pass

    @regional_rpc_method(resolve=ByOrganizationIdAttribute("organization_member"))
    @abstractmethod
    def get_all_org_roles(
        self,
        *,
        organization_member: Optional[RpcOrganizationMember] = None,
        member_id: Optional[int] = None,
    ) -> List[str]:
        pass

    @regional_rpc_method(resolve=ByOrganizationId())
    @abstractmethod
    def get_top_dog_team_member_ids(self, *, organization_id: int) -> List[int]:
        pass


organization_service = cast(OrganizationService, OrganizationService.create_delegation())
