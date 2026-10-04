import { exposeBridge, forwardHubPort } from "./preload.js";
exposeBridge("pluginHost");
forwardHubPort();
