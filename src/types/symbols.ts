/**
 * Symbol Type Definitions
 */

export type SymbolKind =
  | 'class'
  | 'interface'
  | 'function'
  | 'type'
  | 'enum'
  | 'variable'
  | 'namespace'
  | 'component'    // React component (TSX)
  | 'hook';        // React hook (useSomething)

export type RelationshipType =
  | 'implements'   // class implements interface
  | 'extends'      // class/interface extends another
  | 'uses'         // imports/uses another symbol
  | 'contains';    // namespace/module contains

export interface LightweightSymbol {
  name: string;
  kind: SymbolKind;
  filePath: string;
  line: number;
  endLine?: number;
  column: number;
  exported: boolean;
  isDefault: boolean;
  // Metrics
  linesOfCode?: number;
  complexity?: number;
  methodCount?: number;
  fieldCount?: number;
  parameterCount?: number;
  inheritanceDepth?: number;
  // Additional metrics
  maxNestingDepth?: number;
  staticMethodCount?: number;
  staticFieldCount?: number;
  privateMethodCount?: number;
  publicMethodCount?: number;
  asyncMethodCount?: number;
  dependencyCount?: number;  // Number of imports/dependencies
  // New metrics
  importCount?: number;      // Number of imports in file
  todoCount?: number;        // TODO/FIXME comments
  anyTypeCount?: number;     // Usage of 'any' type
  cognitiveComplexity?: number;  // Sonar-style cognitive complexity
  // Structure metrics
  returnCount?: number;      // Number of return statements
  throwCount?: number;       // Number of throw statements
  hasJsDoc?: boolean;        // Has JSDoc comment
  constructorParamCount?: number;  // Constructor parameters (DI complexity)
  implementsCount?: number;  // Number of interfaces implemented
  // Code quality indicators
  commentDensity?: number;   // Comments per LOC ratio (0-1)
  // Class-specific metrics
  isAbstract?: boolean;      // Is an abstract class
  overrideCount?: number;    // Methods overriding parent class
  // Async complexity metrics
  callbackDepth?: number;    // Max nested callback depth
  promiseChainLength?: number; // Max .then()/.catch()/.finally() chain length
}

export interface SymbolRelationship {
  fromSymbol: string;
  toSymbol: string;
  type: RelationshipType;
  filePath: string;
}

export interface DeepSymbol extends LightweightSymbol {
  dependencies: string[];
  dependents: string[];
  complexity: number;
  documentation: string;
  members: DeepSymbol[];
  typeInfo?: TypeInformation;
}

export interface TypeInformation {
  typeString: string;
  isGeneric: boolean;
  typeParameters?: string[];
}
