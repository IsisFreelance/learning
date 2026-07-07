import { readFileSync } from 'fs'
import { beforeAll, afterAll, describe, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'bright-harbor-dental-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

describe('bookings collection', () => {
  it('lets anyone create a booking', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(doc(db, 'bookings', 'test1'), { name: 'Test' }))
  })

  it('blocks anonymous users from reading bookings', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'bookings', 'test1')))
  })

  it('lets a logged-in user read bookings', async () => {
    const db = testEnv.authenticatedContext('staff-uid').firestore()
    await assertSucceeds(getDoc(doc(db, 'bookings', 'test1')))
  })

  it('blocks anonymous users from deleting a booking', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(deleteDoc(doc(db, 'bookings', 'test1')))
  })

  it('lets a logged-in user delete a booking', async () => {
    const db = testEnv.authenticatedContext('staff-uid').firestore()
    await assertSucceeds(deleteDoc(doc(db, 'bookings', 'test1')))
  })
})

describe('bookingSlots collection', () => {
  it('lets anyone create and read a slot', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(doc(db, 'bookingSlots', 'slot1'), { date: '2026-07-07' }))
    await assertSucceeds(getDoc(doc(db, 'bookingSlots', 'slot1')))
  })

  it('never allows updating a slot, even when logged in', async () => {
    const db = testEnv.authenticatedContext('staff-uid').firestore()
    await assertFails(updateDoc(doc(db, 'bookingSlots', 'slot1'), { date: '2026-07-08' }))
  })

  it('blocks anonymous users from deleting a slot', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(deleteDoc(doc(db, 'bookingSlots', 'slot1')))
  })

  it('lets a logged-in user delete a slot', async () => {
    const db = testEnv.authenticatedContext('staff-uid').firestore()
    await assertSucceeds(deleteDoc(doc(db, 'bookingSlots', 'slot1')))
  })
})

describe('counters collection', () => {
  it('allows anyone to read and write', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(doc(db, 'counters', 'bookings'), { count: 1 }))
    await assertSucceeds(getDoc(doc(db, 'counters', 'bookings')))
  })
})
