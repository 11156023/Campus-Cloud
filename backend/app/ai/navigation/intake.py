"""配置模式：先把需求問清楚，再產生配置。

一句「我要一台機器」不足以規劃出對的東西，但直接丟一份猜出來的配置給使用者，
他也無從判斷對不對。所以規劃前先走幾個問題，每題都給可以直接點的選項。

判斷「還缺什麼」完全在本地做（關鍵字 + 選項字面比對），不打模型：問問題這件事
不該花一次推論，也不該因為模型慢而卡住對話。真正的規劃還是交給 /recommend。
"""

from __future__ import annotations

from dataclasses import dataclass

from app.ai.navigation.schemas import (
    IntakeQuestion,
    IntakeState,
    NavigationMessage,
)
from app.ai.template_recommendation.recommendation_service import (
    GPU_KEYWORDS,
    WINDOWS_KEYWORDS,
)

# 圖形介面與 Windows 一樣會把選擇推向 VM，放在同一題問。
_DISPLAY_KEYWORDS = (
    "gui", "圖形介面", "桌面", "遠端桌面", "rdp", "vnc", "視窗",
)
_DURATION_KEYWORDS = (
    "天", "週", "周", "個月", "學期", "小時", "整學期", "長期", "短期",
    "day", "week", "month", "semester",
)


@dataclass(frozen=True)
class IntakeSlot:
    key: str
    question: str
    options: tuple[str, ...]
    keywords: tuple[str, ...] = ()
    # 這一格靠自由描述回答（用途），而不是關鍵字命中
    freeform: bool = False


SLOTS: tuple[IntakeSlot, ...] = (
    IntakeSlot(
        key="purpose",
        question="這台機器主要要拿來做什麼？",
        options=("課程作業", "專題開發", "架設網站", "AI 訓練", "資料庫"),
        freeform=True,
    ),
    IntakeSlot(
        key="gpu",
        question="需要 GPU 嗎？",
        options=("需要 GPU", "不需要 GPU", "不確定，你幫我判斷"),
        keywords=GPU_KEYWORDS,
    ),
    IntakeSlot(
        key="display",
        question="需要 Windows 或圖形桌面嗎？",
        options=("需要圖形桌面", "需要 Windows", "Linux 指令列就好"),
        keywords=WINDOWS_KEYWORDS + _DISPLAY_KEYWORDS,
    ),
    IntakeSlot(
        key="duration",
        question="大概要用多久？",
        options=("幾天", "幾週", "整個學期", "還不確定"),
        keywords=_DURATION_KEYWORDS,
    ),
)

_ALL_OPTIONS = {option for slot in SLOTS for option in slot.options}
# 使用者可能只是點了上一題的選項，那不算描述用途。
_MIN_PURPOSE_LENGTH = 4


def _user_texts(history: list[NavigationMessage] | None) -> list[str]:
    return [
        message.content.strip()
        for message in (history or [])
        if message.role == "user" and message.content.strip()
    ]


def _mentions(text: str, keywords: tuple[str, ...]) -> bool:
    lowered = text.casefold()
    return any(keyword.casefold() in lowered for keyword in keywords)


def _slots_already_replied_to(history: list[NavigationMessage] | None) -> set[str]:
    """問過而且使用者回了話，就算答過——「不用」「沒有」這種也算。

    靠關鍵字判斷答案內容太脆弱（「不用」裡面沒有 GPU 兩個字），所以改看
    「上一句助手問的是哪一格」。
    """
    replied: set[str] = set()
    pending: str | None = None
    for message in history or []:
        if message.role == "assistant":
            for slot in SLOTS:
                if slot.question in message.content:
                    pending = slot.key
                    break
        elif message.role == "user" and message.content.strip() and pending:
            replied.add(pending)
            pending = None
    return replied


def _slot_is_answered(slot: IntakeSlot, texts: list[str], replied: set[str]) -> bool:
    if slot.key in replied:
        return True
    for text in texts:
        # 點選項回答：選項字面出現就算答過，包括「不確定」這種明確跳過。
        if any(option in text for option in slot.options):
            return True
        if slot.freeform:
            stripped = text.strip()
            if stripped in _ALL_OPTIONS:
                continue
            if len(stripped) >= _MIN_PURPOSE_LENGTH:
                return True
            continue
        if _mentions(text, slot.keywords):
            return True
    return False


def read_intake(
    history: list[NavigationMessage] | None,
    asked: list[str] | None = None,
) -> IntakeState:
    """看看還缺哪一格，回傳下一個要問的問題（都齊了就是 ready）。

    ``asked`` 是前端記錄「已經問過的欄位」。問句由推薦 AI 用對話語氣生成，
    字面不會等於這裡的指示文字，所以問過什麼只能由前端帶回來。
    """
    texts = _user_texts(history)
    replied = _slots_already_replied_to(history) | set(asked or [])
    answered = [slot.key for slot in SLOTS if _slot_is_answered(slot, texts, replied)]
    missing = [slot for slot in SLOTS if slot.key not in answered]

    if not missing:
        return IntakeState(
            ready=True,
            answered=len(SLOTS),
            total=len(SLOTS),
            known=answered,
            question=None,
            hint="需求問齊了，我來規劃配置。",
        )

    nxt = missing[0]
    return IntakeState(
        ready=False,
        answered=len(answered),
        total=len(SLOTS),
        known=answered,
        question=IntakeQuestion(
            key=nxt.key,
            text=nxt.question,
            options=list(nxt.options),
        ),
        hint="我先問幾個問題，再依你的答案產生配置。",
    )
