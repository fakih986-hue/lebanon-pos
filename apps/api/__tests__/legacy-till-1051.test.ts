import { legacyTillSuite } from "./legacy-till/suite.js"

// The released 1.0.51 till (v1.0.51, 31e1ce6): LEGACY_TILL_1051_SRC = <checkout>/apps/desktop/src
legacyTillSuite({ label: "1.0.51", srcRoot: process.env.LEGACY_TILL_1051_SRC, commit: "31e1ce61af6a9679c7cda015b32fdbf3bb430149", survivesMissingPin: false, survivesPartialPull: false, sharedPinFallsBackLocally: true })
