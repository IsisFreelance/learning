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


def test_opened_and_confirmed_have_no_transitions_yet():
    # Nothing in Phase 1 ever sets these statuses, so nothing should be able
    # to transition away from them yet either -- Phase 3 extends this.
    assert not is_valid_transition(IntakeStatus.OPENED, IntakeStatus.NEW)
    assert not is_valid_transition(IntakeStatus.CONFIRMED, IntakeStatus.NEW)


def test_cannot_transition_to_confirmed_from_anywhere_in_phase_1():
    for status in IntakeStatus:
        assert not is_valid_transition(status, IntakeStatus.CONFIRMED)
