export const SCENE_RUNTIME_IMPORTS={
  "lucide-react": {file:"lucide-react.mjs",named:["FileText","Mic","Image","Feather"],default:false,namespace:false},
  "react": {
    "file": "react.mjs",
    "named": [
      "Children",
      "Component",
      "Fragment",
      "PureComponent",
      "StrictMode",
      "Suspense",
      "cloneElement",
      "createContext",
      "createElement",
      "createRef",
      "forwardRef",
      "isValidElement",
      "lazy",
      "memo",
      "startTransition",
      "useCallback",
      "useContext",
      "useDebugValue",
      "useDeferredValue",
      "useEffect",
      "useId",
      "useImperativeHandle",
      "useInsertionEffect",
      "useLayoutEffect",
      "useMemo",
      "useReducer",
      "useRef",
      "useState",
      "useSyncExternalStore",
      "useTransition",
      "version"
    ],
    "default": true,
    "namespace": true
  },
  "react/jsx-runtime": {
    "file": "jsx-runtime.mjs",
    "named": [
      "jsx",
      "jsxs",
      "Fragment"
    ],
    "default": false,
    "namespace": false
  },
  "react-dom/client": {
    "file": "react-dom-client.mjs",
    "named": [
      "createRoot"
    ],
    "default": false,
    "namespace": false
  }
};

export const SCENE_RUNTIME_TYPES=Object.fromEntries([...new Set(Object.values(SCENE_RUNTIME_IMPORTS).flatMap(contract=>contract.named))].map(name=>[name,['Fragment','StrictMode','Suspense'].includes(name)?'symbol':name==='Children'?'object':name==='version'?'string':'function']));
SCENE_RUNTIME_TYPES.default='object';

for(const name of SCENE_RUNTIME_IMPORTS["lucide-react"].named)SCENE_RUNTIME_TYPES[name]="object";
