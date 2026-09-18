import Ajv from 'ajv';
import assetModel from './schemas/asset-model-1.json' with {type:'json'};
import deliveryScope from './schemas/delivery-scope-2.json' with {type:'json'};
import reuseDecision from './schemas/reuse-decision-1.json' with {type:'json'};
import semanticReview from './schemas/semantic-review-1.json' with {type:'json'};
import evidence from './schemas/evidence-1.json' with {type:'json'};

// The only Ajv owner. Validation never mutates drafts or loads user schemas.
const ajv = new Ajv({strict:true,allErrors:true,coerceTypes:false,useDefaults:false,removeAdditional:false});
const validators = new Map(Object.entries({assetModel,deliveryScope,reuseDecision,evidence,semanticReview}).map(([name,schema])=>[name,ajv.compile(schema)]));
export function inspectFactContract(kind, value) {
  const validate = validators.get(kind);
  if (!validate) return [{code:'UNKNOWN_CONTRACT',path:'',message:'不支持的事实结构合同'}];
  if (validate(value)) return [];
  return validate.errors.map(error=>({code:'FACT_CONTRACT_INVALID',path:error.instancePath,message:`${kind}${error.instancePath}: ${error.message}`,params:error.params}));
}

export function inspectFactExtensions(facts) {
  const issues = [];
  const add = (kind,value,id) => issues.push(...inspectFactContract(kind,value).map(issue=>({...issue,objectId:id})));
  for(const component of facts.components?.items || []) if(component.assetModel) add('assetModel',component.assetModel,component.id);
  for(const change of facts.changes?.items || []) {
    if(change.deliveryScope && change.deliveryScope.schemaVersion !== '1.0.0') add('deliveryScope',change.deliveryScope,change.id);
    if(change.reuseDecisions!==undefined&&!Array.isArray(change.reuseDecisions))issues.push({objectId:change.id,message:'reuseDecisions 必须为数组'});
    if(change.evidenceIndex!==undefined&&!Array.isArray(change.evidenceIndex))issues.push({objectId:change.id,message:'evidenceIndex 必须为数组'});
    for(const decision of Array.isArray(change.reuseDecisions)?change.reuseDecisions:[])add('reuseDecision',decision,change.id);
    for(const item of Array.isArray(change.evidenceIndex)?change.evidenceIndex:[])add('evidence',item,change.id);
  }
  return issues;
}
