// Optional settings, loaded before the game starts.
//
// Online play connects phones directly and falls back to a shared free relay (PeerJS's) on networks
// that block direct connections. If friends on some network can't connect, add your own relay here.
// For example, a free TURN account from Cloudflare Calls or Metered gives you values like these:
//
// window.RFI_ICE_SERVERS = [
//   { urls: 'turn:YOUR-TURN-HOST:3478', username: 'YOUR-USERNAME', credential: 'YOUR-PASSWORD' },
// ];
//
// Free options for a relay of your own: a Metered.ca account (free tier) or Cloudflare Calls TURN.
// Paste the urls, username and credential they give you into RFI_ICE_SERVERS above and uncomment it.

// Where "Report a problem" can email reports to. Leave it out and people can still Share or Copy a report.
// window.RFI_FEEDBACK_EMAIL = 'you@example.com';
