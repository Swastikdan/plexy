import React from "react";
import { LibraryScreen } from "../../screens/Catalog";
import { useMediaNavigation } from "../../navigation/useMediaNavigation";
export default function LibrariesRoute() { return <LibraryScreen kind="movie" {...useMediaNavigation()} />; }
