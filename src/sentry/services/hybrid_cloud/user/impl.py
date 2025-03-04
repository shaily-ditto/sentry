from __future__ import annotations

from typing import Any, Callable, FrozenSet, Iterable, List, Optional

from django.db.models import QuerySet

from sentry.api.serializers import (
    DetailedSelfUserSerializer,
    DetailedUserSerializer,
    UserSerializer,
)
from sentry.api.serializers.base import Serializer
from sentry.db.models import BaseQuerySet
from sentry.db.models.query import in_iexact
from sentry.models.avatars.user_avatar import UserAvatar
from sentry.models.group import Group
from sentry.models.user import User
from sentry.services.hybrid_cloud.auth import AuthenticationContext
from sentry.services.hybrid_cloud.filter_query import (
    FilterQueryDatabaseImpl,
    OpaqueSerializedResponse,
)
from sentry.services.hybrid_cloud.user import (
    RpcAuthenticator,
    RpcAvatar,
    RpcUser,
    RpcUserEmail,
    UserFilterArgs,
    UserSerializeType,
    UserService,
    UserUpdateArgs,
)


class DatabaseBackedUserService(UserService):
    def serialize_many(
        self,
        *,
        filter: UserFilterArgs,
        as_user: Optional[RpcUser] = None,
        auth_context: Optional[AuthenticationContext] = None,
        serializer: Optional[UserSerializeType] = None,
    ) -> List[OpaqueSerializedResponse]:
        return self._FQ.serialize_many(filter, as_user, auth_context, serializer)

    def get_many(self, *, filter: UserFilterArgs) -> List[RpcUser]:
        return self._FQ.get_many(filter)

    def get_many_by_email(
        self,
        emails: List[str],
        is_active: bool = True,
        is_verified: bool = True,
        is_project_member: bool = False,
        project_id: Optional[int] = None,
    ) -> List[RpcUser]:
        query = self._FQ.base_query()
        if is_verified:
            query = query.filter(emails__is_verified=is_verified)
        if is_active:
            query = query.filter(is_active=is_active)
        if is_project_member:
            query = query.filter(
                sentry_orgmember_set__organizationmemberteam__team__projectteam__project_id__in=[
                    project_id
                ]
            )
        return [
            self._FQ.serialize_rpc(user)
            for user in query.filter(in_iexact("emails__email", emails))
        ]

    def get_by_username(
        self, username: str, with_valid_password: bool = True, is_active: bool | None = None
    ) -> List[RpcUser]:
        qs = self._FQ.base_query()

        if is_active is not None:
            qs = qs.filter(is_active=is_active)

        if with_valid_password:
            qs = qs.exclude(password="!")

        try:
            # First, assume username is an iexact match for username
            user = qs.get(username__iexact=username)
            return [user]
        except User.DoesNotExist:
            # If not, we can take a stab at guessing it's an email address
            if "@" in username:
                # email isn't guaranteed unique
                return list(qs.filter(email__iexact=username))
        return []

    def get_from_group(self, group: Group) -> List[RpcUser]:
        return [
            self._FQ.serialize_rpc(u)
            for u in self._FQ.base_query().filter(
                sentry_orgmember_set__organization=group.organization,
                sentry_orgmember_set__teams__in=group.project.teams.all(),
                is_active=True,
            )
        ]

    def get_by_actor_ids(self, *, actor_ids: List[int]) -> List[RpcUser]:
        return [
            self._FQ.serialize_rpc(u) for u in self._FQ.base_query().filter(actor_id__in=actor_ids)
        ]

    def update_user(
        self,
        *,
        user_id: int,
        attrs: UserUpdateArgs,
    ) -> Any:
        if len(attrs):
            User.objects.filter(id=user_id).update(**attrs)
        return self.serialize_many(filter=dict(user_ids=[user_id]))[0]

    def close(self) -> None:
        pass

    class _UserFilterQuery(
        FilterQueryDatabaseImpl[User, UserFilterArgs, RpcUser, UserSerializeType],
    ):
        def apply_filters(
            self,
            query: BaseQuerySet,
            filters: UserFilterArgs,
        ) -> List[User]:
            if "user_ids" in filters:
                query = query.filter(id__in=filters["user_ids"])
            if "is_active" in filters:
                query = query.filter(is_active=filters["is_active"])
            if "organization_id" in filters:
                query = query.filter(
                    sentry_orgmember_set__organization_id=filters["organization_id"]
                )
            if "is_active_memberteam" in filters:
                query = query.filter(
                    sentry_orgmember_set__organizationmemberteam__is_active=filters[
                        "is_active_memberteam"
                    ],
                )
            if "project_ids" in filters:
                query = query.filter(
                    sentry_orgmember_set__organizationmemberteam__team__projectteam__project_id__in=filters[
                        "project_ids"
                    ]
                )
            if "team_ids" in filters:
                query = query.filter(
                    sentry_orgmember_set__organizationmemberteam__team_id__in=filters["team_ids"],
                )
            if "emails" in filters:
                query = query.filter(in_iexact("emails__email", filters["emails"]))

            return list(query)

        def base_query(self) -> QuerySet:
            return User.objects.extra(
                select={
                    "permissions": "select array_agg(permission) from sentry_userpermission where user_id=auth_user.id",
                    "roles": """
                        SELECT array_agg(permissions)
                        FROM sentry_userrole
                        JOIN sentry_userrole_users
                          ON sentry_userrole_users.role_id=sentry_userrole.id
                       WHERE user_id=auth_user.id""",
                    "useremails": "select array_agg(row_to_json(sentry_useremail)) from sentry_useremail where user_id=auth_user.id",
                    "authenticators": "SELECT array_agg(row_to_json(auth_authenticator)) FROM auth_authenticator WHERE user_id=auth_user.id",
                    "useravatar": "SELECT array_agg(row_to_json(sentry_useravatar)) FROM sentry_useravatar WHERE user_id = auth_user.id",
                }
            )

        def filter_arg_validator(self) -> Callable[[UserFilterArgs], Optional[str]]:
            return self._filter_has_any_key_validator(
                "user_ids", "organization_id", "team_ids", "project_ids", "emails"
            )

        def serialize_api(self, serializer_type: Optional[UserSerializeType]) -> Serializer:
            serializer: Serializer = UserSerializer()
            if serializer_type == UserSerializeType.DETAILED:
                serializer = DetailedUserSerializer()
            if serializer_type == UserSerializeType.SELF_DETAILED:
                serializer = DetailedSelfUserSerializer()
            return serializer

        def serialize_rpc(self, user: User) -> RpcUser:
            return serialize_rpc_user(user)

    _FQ = _UserFilterQuery()


def serialize_rpc_user(user: User) -> RpcUser:
    args = {
        field_name: getattr(user, field_name)
        for field_name in RpcUser.__fields__
        if hasattr(user, field_name)
    }
    args["pk"] = user.pk
    args["display_name"] = user.get_display_name()
    args["label"] = user.get_label()
    args["is_superuser"] = user.is_superuser
    args["is_sentry_app"] = user.is_sentry_app or False
    args["password_usable"] = user.has_usable_password()

    # Prefer eagerloaded attributes from _base_query
    if hasattr(user, "useremails") and user.useremails is not None:
        args["emails"] = frozenset([e["email"] for e in user.useremails if e["is_verified"]])
    else:
        args["emails"] = frozenset([email.email for email in user.get_verified_emails()])
    args["session_nonce"] = user.session_nonce

    # And process the _base_query special data additions
    args["permissions"] = frozenset(getattr(user, "permissions", None) or ())

    if args["name"] is None:
        # This field is non-nullable according to the Django schema, but may be null
        # on some servers due to migration history
        args["name"] = ""

    roles: FrozenSet[str] = frozenset()
    if hasattr(user, "roles") and user.roles is not None:
        roles = frozenset(flatten(user.roles))
    args["roles"] = roles

    args["useremails"] = [
        RpcUserEmail(id=e["id"], email=e["email"], is_verified=e["is_verified"])
        for e in (getattr(user, "useremails", None) or ())
    ]

    avatar = None
    # Use eagerloaded attributes from _base_query() if available.
    if hasattr(user, "useravatar"):
        if user.useravatar is not None:
            avatar_dict = user.useravatar[0]
            avatar_type_map = dict(UserAvatar.AVATAR_TYPES)
            avatar = RpcAvatar(
                id=avatar_dict["id"],
                file_id=avatar_dict["file_id"],
                ident=avatar_dict["ident"],
                avatar_type=avatar_type_map.get(avatar_dict["avatar_type"], "letter_avatar"),
            )
    else:
        orm_avatar = user.avatar.first()
        if orm_avatar is not None:
            avatar = RpcAvatar(
                id=orm_avatar.id,
                file_id=orm_avatar.file_id,
                ident=orm_avatar.ident,
                avatar_type=orm_avatar.get_avatar_type_display(),
            )
    args["avatar"] = avatar

    args["authenticators"] = [
        RpcAuthenticator(
            id=a["id"],
            user_id=a["user_id"],
            created_at=a["created_at"],
            last_used_at=a["last_used_at"],
            type=a["type"],
            config=a["config"],
        )
        for a in (getattr(user, "authenticators", None) or ())
    ]

    return RpcUser(**args)


def flatten(iter: Iterable[Any]) -> List[Any]:
    return (
        ((flatten(iter[0]) + flatten(iter[1:])) if len(iter) > 0 else [])
        if type(iter) is list or isinstance(iter, BaseQuerySet)
        else [iter]
    )
