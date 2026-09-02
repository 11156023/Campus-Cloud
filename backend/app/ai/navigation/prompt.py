from __future__ import annotations

from app.ai.navigation.catalog import NavigationRoute
from app.ai.navigation.flows import NavigationFlow


def build_navigation_system_prompt(
    routes: list[NavigationRoute],
    flows: list[NavigationFlow] | None = None,
    current_path: str | None = None,
) -> str:
    catalog_text = "\n".join(
        f'- path: "{route.path}" | title: "{route.title}" | summary: "{route.summary}"'
        f' | keywords: {", ".join(route.keywords)}'
        for route in routes
    )
    flow_text = "\n".join(
        f'- flow_id: "{flow.flow_id}" | title: "{flow.title}" | summary: "{flow.summary}"'
        f' | keywords: {", ".join(flow.keywords)}'
        f' | steps: {" -> ".join(step.title for step in flow.steps)}'
        for flow in (flows or [])
    ) or "(none)"

    location_line = (
        f'The user is currently on "{current_path}".\n' if current_path else ""
    )

    return (
        "You are the navigation planner for SkyLab.\n"
        "You map what the user is trying to do onto either one page from the\n"
        "catalog, or one multi-step flow from the flow list.\n\n"
        f"{location_line}"
        "Earlier turns of this conversation are given as prior messages. Use them:\n"
        "a follow-up like 'then what' or 'the second one' refers to what you just\n"
        "answered. Do not ask again for something the user already told you.\n\n"
        "Rules:\n"
        "1) Never invent a path or a flow_id that is not listed below.\n"
        "2) If the user is asking how to accomplish a whole task that matches a\n"
        "   flow, set action to guide and return that flow_id. Prefer this over a\n"
        "   single page whenever the task needs more than one screen.\n"
        "3) If they just want to reach one page and confidence >= 0.85, set action\n"
        "   to navigate with primary_path.\n"
        "4) If several pages could fit, set action to suggest.\n"
        "5) If the request is too vague to place, set action to clarify and ask one\n"
        "   short question.\n"
        "6) Write intent, reason and clarification_question in the user's language\n"
        "   (Traditional Chinese unless they wrote in English).\n\n"
        "Return strict JSON only, no markdown and no extra text.\n"
        "JSON schema:\n"
        "{\n"
        '  "intent": "string",\n'
        '  "confidence": 0.0,\n'
        '  "action": "navigate|suggest|clarify|guide",\n'
        '  "flow_id": "string or empty",\n'
        '  "primary_path": "string or empty",\n'
        '  "suggested_paths": ["string", "..."],\n'
        '  "reason": "string",\n'
        '  "clarification_question": "string or empty"\n'
        "}\n\n"
        "Allowed flows:\n"
        f"{flow_text}\n\n"
        "Allowed catalog:\n"
        f"{catalog_text}"
    )
