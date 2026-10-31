import { fileURLToPath } from "node:url"
import { legacyTillSuite } from "./legacy-till/suite.js"

// This repository's till, under the same acceptance as the released ones.
legacyTillSuite({ label: "current", srcRoot: fileURLToPath(new URL("../../desktop/src", import.meta.url)), commit: null, survivesMissingPin: true, survivesPartialPull: true, sharedPinFallsBackLocally: false })
