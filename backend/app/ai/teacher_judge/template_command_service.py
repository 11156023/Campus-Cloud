"""Template command catalog helpers for Teacher Judge rubric analysis."""

from __future__ import annotations

from typing import Any

from sqlmodel import Session, select

from app.models.teacher_judge_template_command import TeacherJudgeTemplateCommand

SUPPORTED_TEMPLATE_KEYS = {"linux", "python", "n8n", "postgresql"}


def get_enabled_template_commands(
    session: Session,
    template_key: str,
    *,
    include_cross_template: bool = False,
) -> list[TeacherJudgeTemplateCommand]:
    """Return enabled commands, optionally including controlled cross-template capabilities."""
    statement = (
        select(TeacherJudgeTemplateCommand)
        .where(TeacherJudgeTemplateCommand.enabled == True)  # noqa: E712
        .order_by(
            TeacherJudgeTemplateCommand.template_key,
            TeacherJudgeTemplateCommand.category,
            TeacherJudgeTemplateCommand.command_key,
        )
    )
    if not include_cross_template:
        statement = statement.where(
            TeacherJudgeTemplateCommand.template_key == template_key
        )
    commands = list(session.exec(statement).all())
    if include_cross_template:
        commands.sort(
            key=lambda command: (
                command.template_key != template_key,
                command.template_key,
                command.category,
                command.command_key,
            )
        )
    return commands


def format_template_commands_for_prompt(
    commands: list[TeacherJudgeTemplateCommand],
) -> str:
    """Format enabled commands for LLM prompt injection."""
    if not commands:
        return "目前沒有 template command catalog；請不要產生 check_steps。"

    lines = []
    for command in commands:
        lines.append(
            "\n".join(
                [
                    f"- template_key: {command.template_key}",
                    f"  command_key: {command.command_key}",
                    f"  command_label: {command.command_label}",
                    f"  category: {command.category}",
                    f"  description: {command.description}",
                    f"  risk_level: {command.risk_level}",
                    f"  requires_confirmation: {command.requires_confirmation}",
                ]
            )
        )
    return "\n".join(lines)


def validate_check_steps(
    template_key: str,
    items: list[dict[str, Any]],
    commands: list[TeacherJudgeTemplateCommand],
) -> list[dict[str, Any]]:
    """
    Keep only check steps that reference enabled commands for the selected template.

    This helper accepts item-shaped dictionaries so tests and callers can validate
    raw LLM payloads without needing to instantiate Pydantic schemas first.
    """
    valid_commands = {
        (command.template_key, command.command_key): command for command in commands
    }
    normalized_items: list[dict[str, Any]] = []
    for item in items:
        next_item = dict(item)
        valid_steps: list[dict[str, str]] = []
        raw_steps = item.get("check_steps")
        if isinstance(raw_steps, list):
            for raw_step in raw_steps:
                if not isinstance(raw_step, dict):
                    continue
                step_template_key = str(raw_step.get("template_key") or template_key).strip()
                command_key = str(raw_step.get("command_key") or "").strip()
                command = valid_commands.get((step_template_key, command_key))
                if command is None:
                    continue
                valid_steps.append(
                    {
                        "template_key": command.template_key,
                        "command_key": command.command_key,
                        "command_label": command.command_label,
                    }
                )
        next_item["check_steps"] = valid_steps
        normalized_items.append(next_item)
    return normalized_items


__all__ = [
    "SUPPORTED_TEMPLATE_KEYS",
    "format_template_commands_for_prompt",
    "get_enabled_template_commands",
    "validate_check_steps",
]
