from app.models import IntakeStatus, is_valid_transition


def test_new_can_move_to_archived_rejected_or_deleted():
    assert is_valid_transition(IntakeStatus.NEW, IntakeStatus.ARCHIVED)
    assert is_valid_transition(IntakeStatus.NEW, IntakeStatus.REJECTED)
    assert is_valid_transition(IntakeStatus.NEW, IntakeStatus.DELETED)


def test_archived_rejected_and_deleted_can_only_restore_to_new():
    assert is_valid_transition(IntakeStatus.ARCHIVED, IntakeStatus.NEW)
    assert is_valid_transition(IntakeStatus.REJECTED, IntakeStatus.NEW)
    assert is_valid_transition(IntakeStatus.DELETED, IntakeStatus.NEW)

    assert not is_valid_transition(IntakeStatus.ARCHIVED, IntakeStatus.REJECTED)
    assert not is_valid_transition(IntakeStatus.REJECTED, IntakeStatus.DELETED)


def test_new_can_be_opened_for_review():
    assert is_valid_transition(IntakeStatus.NEW, IntakeStatus.OPENED)


def test_opened_can_be_confirmed_or_cancelled_back_to_new():
    assert is_valid_transition(IntakeStatus.OPENED, IntakeStatus.CONFIRMED)
    assert is_valid_transition(IntakeStatus.OPENED, IntakeStatus.NEW)


def test_opened_cannot_go_straight_to_archived_rejected_or_deleted():
    # Scope trim: cancel back to NEW first, then use those actions from there.
    assert not is_valid_transition(IntakeStatus.OPENED, IntakeStatus.ARCHIVED)
    assert not is_valid_transition(IntakeStatus.OPENED, IntakeStatus.REJECTED)
    assert not is_valid_transition(IntakeStatus.OPENED, IntakeStatus.DELETED)


def test_confirmed_is_terminal():
    for status in IntakeStatus:
        assert not is_valid_transition(IntakeStatus.CONFIRMED, status)


def test_cannot_confirm_from_anywhere_except_opened():
    for status in IntakeStatus:
        if status is IntakeStatus.OPENED:
            continue
        assert not is_valid_transition(status, IntakeStatus.CONFIRMED)
