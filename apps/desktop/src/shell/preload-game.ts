import { exposeBridge, forwardHubPort } from "./preload.js";
exposeBridge("game");
forwardHubPort();
