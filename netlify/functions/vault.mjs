import {getStore} from '@netlify/blobs';
import {makeHandler} from '../../server/vault-handler.mjs';
export default makeHandler({getConfig:()=>process.env.ISAAC_VAULT_AUTH,getStore:()=>getStore({name:'isaac-vault-v1',consistency:'strong'})});
export const config={rateLimit:{action:'rate_limit',aggregateBy:['ip','domain'],windowLimit:120,windowSize:60}};
