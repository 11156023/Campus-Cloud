"""配置模式的問答推進：問到齊為止，而且不重複問已經講過的事。"""

from __future__ import annotations

from app.ai.navigation.intake import SLOTS, read_intake
from app.ai.navigation.schemas import NavigationMessage


def _history(*texts: str) -> list[NavigationMessage]:
    """把使用者說過的話串成對話（助手那側的內容不影響判斷）。"""
    history: list[NavigationMessage] = []
    for text in texts:
        history.append(NavigationMessage(role="user", content=text))
        history.append(NavigationMessage(role="assistant", content="好的。"))
    return history


def test_empty_conversation_asks_what_it_is_for() -> None:
    state = read_intake([])

    assert state.ready is False
    assert state.answered == 0
    assert state.total == len(SLOTS)
    assert state.question is not None
    assert state.question.key == "purpose"
    assert state.question.options  # 每題都要能直接點，不用打字


def test_a_described_purpose_moves_on_to_the_next_question() -> None:
    state = read_intake(_history("我要寫課程作業"))

    assert state.question is not None
    assert state.question.key == "gpu"
    assert "purpose" in state.known


def test_a_workload_that_implies_a_gpu_is_not_asked_about_again() -> None:
    """說了「深度學習」就等於回答了 GPU 那題，別再問一次。"""
    state = read_intake(_history("我想跑深度學習訓練"))

    assert set(state.known) >= {"purpose", "gpu"}
    assert state.question is not None
    assert state.question.key == "display"


def test_what_the_user_already_said_is_not_asked_again() -> None:
    """提到 GPU 就不必再問一次要不要 GPU。"""
    state = read_intake(_history("我要跑 PyTorch 訓練，需要 GPU"))

    assert state.question is not None
    assert state.question.key == "display"
    assert set(state.known) == {"purpose", "gpu"}


def test_saying_no_counts_as_an_answer() -> None:
    state = read_intake(_history("架一個網站", "不需要 GPU"))

    assert "gpu" in state.known
    assert state.question is not None
    assert state.question.key == "display"


def test_not_sure_still_counts_so_the_question_does_not_repeat() -> None:
    state = read_intake(_history("課程作業要用", "不確定，你幫我判斷"))

    assert "gpu" in state.known


def test_clicking_an_option_does_not_count_as_describing_the_purpose() -> None:
    """先點了選項卻還沒說用途時，仍要問用途。"""
    state = read_intake(_history("需要 GPU"))

    assert state.question is not None
    assert state.question.key == "purpose"
    assert "gpu" in state.known


def test_a_bare_no_answers_the_question_that_was_just_asked() -> None:
    """「不用」裡沒有任何關鍵字，但它明明就是上一題的答案。"""
    asked = SLOTS[2]  # 需要 Windows 或圖形桌面嗎？
    history = [
        NavigationMessage(role="user", content="我要架一個網站"),
        NavigationMessage(role="assistant", content="不需要 GPU 嗎？"),
        NavigationMessage(role="user", content="不需要 GPU"),
        NavigationMessage(role="assistant", content=asked.question),
        NavigationMessage(role="user", content="不用"),
    ]

    state = read_intake(history)

    assert "display" in state.known
    assert state.question is not None
    assert state.question.key == "duration"


def test_all_answered_is_ready_to_plan() -> None:
    state = read_intake(
        _history("我要架一個 Flask 網站", "不需要 GPU", "Linux 指令列就好", "整個學期")
    )

    assert state.ready is True
    assert state.question is None
    assert state.answered == state.total


def test_the_flow_comes_along_so_planning_does_not_dead_end() -> None:
    """不管從哪裡進配置模式，配置產生後都要接得回申請流程。"""
    asking = read_intake(_history("我要架網站"))
    assert asking.flow_id == "request_machine"
    # 還在問的時候，進度停在「規劃配置」那一步
    current = [step.index for step in asking.steps if step.status == "current"]
    assert current == [0]
    assert asking.steps[0].action == "recommend"

    done = read_intake(
        _history("我要架網站", "不需要 GPU", "Linux 指令列就好", "整個學期")
    )
    assert done.ready is True
    # 問完了，下一步是填申請單
    assert [step.status for step in done.steps][:2] == ["done", "current"]
    assert done.steps[1].state == {"create": True}


def test_a_single_rich_sentence_can_answer_several_questions_at_once() -> None:
    """講得夠清楚的人不該被問四次。"""
    state = read_intake(
        _history("我要用 Windows 桌面跑一個學期的專題，需要 GPU")
    )

    assert state.ready is True
