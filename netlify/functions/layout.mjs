import{getStore}from'@netlify/blobs';import{makeLayoutHandler}from'../../server/layout-handler.mjs';
export default makeLayoutHandler({getConfig:()=>process.env.ISAAC_VAULT_AUTH,getStore:()=>getStore({name:'isaac-layout-v1',consistency:'strong'})});
export const config={rateLimit:{action:'rate_limit',aggregateBy:['ip','domain'],windowLimit:120,windowSize:60}};
