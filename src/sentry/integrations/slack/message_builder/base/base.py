from __future__ import annotations

from abc import ABC
from typing import Any, Mapping, MutableMapping, Sequence

from sentry.eventstore.models import Event, GroupEvent
from sentry.integrations.message_builder import AbstractMessageBuilder
from sentry.integrations.slack.message_builder import LEVEL_TO_COLOR, SlackBody
from sentry.integrations.slack.utils.escape import escape_slack_text
from sentry.issues.grouptype import GroupCategory
from sentry.models import Group
from sentry.notifications.utils.actions import MessageAction
from sentry.utils.assets import get_asset_url
from sentry.utils.http import absolute_uri


def get_slack_button(action: MessageAction) -> Mapping[str, Any]:
    kwargs: MutableMapping[str, Any] = {
        "text": action.label or action.name,
        "name": action.name,
        "type": action.type,
    }
    for field in ("style", "url", "value", "action_id"):
        value = getattr(action, field, None)
        if value:
            kwargs[field] = value

    if action.type == "select":
        kwargs["selected_options"] = action.selected_options or []
        kwargs["option_groups"] = action.option_groups or []

    return kwargs


class SlackMessageBuilder(AbstractMessageBuilder, ABC):
    def build(self) -> SlackBody:
        """Abstract `build` method that all inheritors must implement."""
        raise NotImplementedError

    def build_fallback_text(self, obj: Group | Event | GroupEvent, project_slug: str) -> str:
        """Fallback text is used in the message preview popup."""
        title = obj.title
        group = getattr(obj, "group", obj)
        if group.issue_category == GroupCategory.PERFORMANCE:
            title = group.issue_type.description

        elif isinstance(obj, GroupEvent) and obj.occurrence is not None:
            title = obj.occurrence.issue_title

        return f"[{project_slug}] {title}"

    @property
    def escape_text(self) -> bool:
        """
        Returns True if we need to escape the text in the message.
        """
        return False

    def _build(
        self,
        text: str,
        title: str | None = None,
        title_link: str | None = None,
        footer: str | None = None,
        color: str | None = None,
        actions: Sequence[MessageAction] | None = None,
        **kwargs: Any,
    ) -> SlackBody:
        """
        Helper to DRY up Slack specific fields.

        :param string text: Body text.
        :param [string] title: Title text.
        :param [string] title_link: Optional URL attached to the title.
        :param [string] footer: Footer text.
        :param [string] color: The key in the Slack palate table, NOT hex. Default: "info".
        :param [list[MessageAction]] actions: List of actions displayed alongside the message.
        :param kwargs: Everything else.
        """
        # If `footer` string is passed, automatically attach a `footer_icon`.
        if footer:
            kwargs["footer"] = footer
            kwargs["footer_icon"] = str(
                absolute_uri(get_asset_url("sentry", "images/sentry-email-avatar.png"))
            )

        if title:
            kwargs["title"] = title
            if title_link:
                kwargs["title_link"] = title_link

        if actions is not None:
            kwargs["actions"] = [get_slack_button(action) for action in actions]

        markdown_in = ["text"]
        if self.escape_text:
            text = escape_slack_text(
                escape_slack_text(text)
            )  # Slack will un-escape so we have to double escape
            markdown_in = []

        return {
            "text": text,
            "mrkdwn_in": markdown_in,
            "color": LEVEL_TO_COLOR[color or "info"],
            **kwargs,
        }
