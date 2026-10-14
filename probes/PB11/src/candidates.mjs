import { fetchText } from './https-fetch.mjs'
import { fetchTextNaive } from './naive.mjs'
import { openFeed } from './ws-lite.mjs'
import { openFeedGlobalDispatcher, openFeedGlobalPlain, openFeedWsLib } from './ws-others.mjs'

export const HTTPS = { A_https_request: fetchText, N_naive_control: fetchTextNaive }
export const WSS = {
  W1_global_plain: openFeedGlobalPlain,
  W1b_global_dispatcher: openFeedGlobalDispatcher,
  W2_ws_lite: openFeed,
  W3_ws_lib: openFeedWsLib,
}
