import { legacyTillSuite } from "./legacy-till/suite.js"

// The released 1.0.50 till (v1.0.50, 7df7c58): LEGACY_TILL_1050_SRC = <checkout>/apps/desktop/src
legacyTillSuite({ label: "1.0.50", srcRoot: process.env.LEGACY_TILL_1050_SRC, commit: "7df7c5836592739eff67738ad6f351d6f556e378", survivesMissingPin: false, survivesPartialPull: false, sharedPinFallsBackLocally: true })
