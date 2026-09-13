import { describe,it,expect } from 'vitest';
import { confirmProviderProfile } from './provider-resource-profile.js';
import type { ResourceProfile } from '@patchwork/shared';
const evidence = {sourceUrl:'https://example.org',sourceName:'Provider',reviewStatus:'reviewed' as const,confirmedAt:'2026-01-01T00:00:00.000Z',expiresAt:'2026-02-01T00:00:00.000Z'};
const profile:ResourceProfile = {version:1,services:[{id:'food',name:'Food',cost:{value:'Free',evidence},eligibility:[{question:'ageYears',operator:'at-least',value:18,description:'Adults',evidence}]}]};
describe('provider evidence confirmation',()=>{
 it('preserves expired evidence through unrelated edits and forged client timestamps',()=>{
  const next=structuredClone(profile);next.organizationName='Updated organization';next.services[0]!.cost!.evidence.expiresAt='2099-01-01T00:00:00.000Z';
  expect(confirmProviderProfile(next,profile,[]).services).toEqual(profile.services);
 });
 it('renews only changed assertions unless the service is explicitly reconfirmed',()=>{
  const now=new Date('2026-09-13T00:00:00.000Z');const next=structuredClone(profile);next.services[0]!.cost!.value='$5';
  const changed=confirmProviderProfile(next,profile,[],now).services[0]!;
  expect(changed.cost!.evidence.confirmedAt).toBe(now.toISOString());expect(changed.eligibility[0]!.evidence).toEqual(evidence);
  const confirmed=confirmProviderProfile(profile,profile,['food'],now).services[0]!;
  expect(confirmed.eligibility[0]!.evidence.confirmedAt).toBe(now.toISOString());expect(confirmed.cost!.evidence.expiresAt).toBe('2026-10-13T00:00:00.000Z');
 });
});
