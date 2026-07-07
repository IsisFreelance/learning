import { getAuth } from 'firebase/auth'
import { app } from './firebaseClient'

// Split out from firebaseClient.js so the `firebase/auth` package only
// ends up in the staff dashboard's lazy-loaded bundle, not the public site.
export const auth = getAuth(app)
