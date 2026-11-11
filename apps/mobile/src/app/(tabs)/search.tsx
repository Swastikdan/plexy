import React from "react";
import { SearchScreen } from "../../screens/Catalog";
import { useMediaNavigation } from "../../navigation/useMediaNavigation";
export default function SearchRoute() { return <SearchScreen {...useMediaNavigation()} />; }
