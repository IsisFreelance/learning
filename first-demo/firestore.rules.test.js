import { readFileSync } from 'fs'
import { beforeAll, afterAll, describe, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'

let testEnv

const validBooking = {
  services: ['Cleanings'],
  totalMinutes: 30,
  date: '2026-07-07',
  startTime: '09:00',
  endTime: '09:30',
  name: 'Test Patient',
  email: 'patient@example.com',
  phone: '555-0100',
  reference: 'BHD-000001',
  status: 'Pending',
  createdAt: serverTimestamp(),
  manageToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
}

const validBookingSlot = {
  date: '2026-07-07',
  time: '09:00',
  bookingId: 'test1',
}

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
  it('lets anyone create a valid booking', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(doc(db, 'bookings', 'test1'), validBooking))
  })

  it('blocks a booking missing required fields', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(doc(db, 'bookings', 'test2'), { name: 'Test' }))
  })

  it('blocks a booking with an unexpected extra field', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(
      setDoc(doc(db, 'bookings', 'test3'), { ...validBooking, notes: 'not allowed' })
    )
  })

  it('blocks a booking with the wrong reference format', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(
      setDoc(doc(db, 'bookings', 'test4'), { ...validBooking, reference: 'NOT-000001' })
    )
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
  it('lets anyone create and read a valid slot', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(doc(db, 'bookingSlots', 'slot1'), validBookingSlot))
    await assertSucceeds(getDoc(doc(db, 'bookingSlots', 'slot1')))
  })

  it('blocks a slot missing required fields', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(doc(db, 'bookingSlots', 'slot2'), { date: '2026-07-07' }))
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
  it('lets anyone create the counter starting at 1', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(doc(db, 'counters', 'bookings'), { count: 1 }))
    await assertSucceeds(getDoc(doc(db, 'counters', 'bookings')))
  })

  it('lets anyone increment the counter by exactly 1', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertSucceeds(updateDoc(doc(db, 'counters', 'bookings'), { count: 2 }))
  })

  it('blocks skipping ahead in the counter', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(updateDoc(doc(db, 'counters', 'bookings'), { count: 10 }))
  })

  it('blocks rewinding the counter', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(updateDoc(doc(db, 'counters', 'bookings'), { count: 1 }))
  })

  it('blocks a non-numeric count', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(updateDoc(doc(db, 'counters', 'bookings'), { count: 'two' }))
  })

  it('blocks deleting the counter', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(deleteDoc(doc(db, 'counters', 'bookings')))
  })
})
