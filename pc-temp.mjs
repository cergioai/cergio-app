import { parse } from '@babel/parser';
import { readFileSync } from 'fs';
const files = [
 'src/screens/ConnectorRequestsScreen.jsx',
 'src/screens/BrowseConnectorsScreen.jsx',
 'src/screens/CalendarScreen.jsx',
 'src/screens/ManageServicesScreen.jsx',
 'src/screens/ServiceDetailProviderScreen.jsx',
 'src/screens/ProfileScreen.jsx',
 'src/screens/RainmakerRequestScreen.jsx',
 'src/components/ui/RequestSpotlightModal.jsx',
 'src/components/ui/CounterSpotlightModal.jsx',
 'src/components/ui/SpotlightPaymentModal.jsx',
 'src/components/ui/MarkPostedModal.jsx',
];
let fail=0;
for (const f of files) {
  try { parse(readFileSync(f,'utf8'), { sourceType:'module', plugins:['jsx'] }); console.log('OK  ', f); }
  catch(e){ fail=1; console.log('FAIL', f, e.message); }
}
process.exit(fail);
