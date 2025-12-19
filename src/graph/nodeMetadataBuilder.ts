/**
 * Node Metadata Builder
 * 
 * Provides a type-safe, fluent API for building NodeMetadata objects.
 * Reduces verbosity and ensures consistent defaults.
 */

import { NodeMetadata, GitChangeStatus, LightweightSymbol } from '../types';

/**
 * Default values for required NodeMetadata fields
 */
const DEFAULT_METADATA: NodeMetadata = {
  linesOfCode: 0,
  complexity: 0,
  exportCount: 0,
  importCount: 0,
  isEntryPoint: false
};

/**
 * Builder class for creating NodeMetadata objects with a fluent API
 */
export class NodeMetadataBuilder {
  private metadata: NodeMetadata;

  constructor() {
    this.metadata = { ...DEFAULT_METADATA };
  }

  /**
   * Create a new builder instance
   */
  static create(): NodeMetadataBuilder {
    return new NodeMetadataBuilder();
  }

  /**
   * Create a builder initialized from a LightweightSymbol
   * Automatically maps all matching symbol metrics to metadata fields
   */
  static fromSymbol(symbol: LightweightSymbol): NodeMetadataBuilder {
    const builder = new NodeMetadataBuilder();
    
    return builder
      .linesOfCode(symbol.linesOfCode || 0)
      .complexity(symbol.complexity || 1)
      .cognitiveComplexity(symbol.cognitiveComplexity)
      .methodCount(symbol.methodCount)
      .fieldCount(symbol.fieldCount)
      .parameterCount(symbol.parameterCount)
      .inheritanceDepth(symbol.inheritanceDepth)
      .maxNestingDepth(symbol.maxNestingDepth)
      .staticMethodCount(symbol.staticMethodCount)
      .staticFieldCount(symbol.staticFieldCount)
      .privateMethodCount(symbol.privateMethodCount)
      .publicMethodCount(symbol.publicMethodCount)
      .asyncMethodCount(symbol.asyncMethodCount)
      .todoCount(symbol.todoCount)
      .anyTypeCount(symbol.anyTypeCount)
      .returnCount(symbol.returnCount)
      .throwCount(symbol.throwCount)
      .hasJsDoc(symbol.hasJsDoc)
      .constructorParamCount(symbol.constructorParamCount)
      .implementsCount(symbol.implementsCount)
      .commentDensity(symbol.commentDensity)
      .isAbstract(symbol.isAbstract)
      .overrideCount(symbol.overrideCount)
      .callbackDepth(symbol.callbackDepth)
      .promiseChainLength(symbol.promiseChainLength);
  }

  /**
   * Create default metadata with required fields only
   */
  static defaults(): NodeMetadata {
    return { ...DEFAULT_METADATA };
  }

  // Required field setters

  linesOfCode(value: number): this {
    this.metadata.linesOfCode = value;
    return this;
  }

  complexity(value: number): this {
    this.metadata.complexity = value;
    return this;
  }

  exportCount(value: number): this {
    this.metadata.exportCount = value;
    return this;
  }

  importCount(value: number): this {
    this.metadata.importCount = value;
    return this;
  }

  isEntryPoint(value: boolean): this {
    this.metadata.isEntryPoint = value;
    return this;
  }

  // Git status

  gitStatus(value: GitChangeStatus | undefined): this {
    this.metadata.gitStatus = value;
    return this;
  }

  // Class/Interface metrics

  methodCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.methodCount = value;
    return this;
  }

  fieldCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.fieldCount = value;
    return this;
  }

  parameterCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.parameterCount = value;
    return this;
  }

  inheritanceDepth(value: number | undefined): this {
    if (value !== undefined) this.metadata.inheritanceDepth = value;
    return this;
  }

  // Coupling metrics

  efferentCoupling(value: number | undefined): this {
    if (value !== undefined) this.metadata.efferentCoupling = value;
    return this;
  }

  afferentCoupling(value: number | undefined): this {
    if (value !== undefined) this.metadata.afferentCoupling = value;
    return this;
  }

  // Extended metrics

  maxNestingDepth(value: number | undefined): this {
    if (value !== undefined) this.metadata.maxNestingDepth = value;
    return this;
  }

  staticMethodCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.staticMethodCount = value;
    return this;
  }

  staticFieldCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.staticFieldCount = value;
    return this;
  }

  privateMethodCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.privateMethodCount = value;
    return this;
  }

  publicMethodCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.publicMethodCount = value;
    return this;
  }

  asyncMethodCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.asyncMethodCount = value;
    return this;
  }

  // Code quality metrics

  todoCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.todoCount = value;
    return this;
  }

  anyTypeCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.anyTypeCount = value;
    return this;
  }

  cognitiveComplexity(value: number | undefined): this {
    if (value !== undefined) this.metadata.cognitiveComplexity = value;
    return this;
  }

  // Structure metrics

  returnCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.returnCount = value;
    return this;
  }

  throwCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.throwCount = value;
    return this;
  }

  hasJsDoc(value: boolean | undefined): this {
    if (value !== undefined) this.metadata.hasJsDoc = value;
    return this;
  }

  constructorParamCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.constructorParamCount = value;
    return this;
  }

  implementsCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.implementsCount = value;
    return this;
  }

  commentDensity(value: number | undefined): this {
    if (value !== undefined) this.metadata.commentDensity = value;
    return this;
  }

  // Class-specific metrics

  isAbstract(value: boolean | undefined): this {
    if (value !== undefined) this.metadata.isAbstract = value;
    return this;
  }

  overrideCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.overrideCount = value;
    return this;
  }

  // Async complexity metrics

  callbackDepth(value: number | undefined): this {
    if (value !== undefined) this.metadata.callbackDepth = value;
    return this;
  }

  promiseChainLength(value: number | undefined): this {
    if (value !== undefined) this.metadata.promiseChainLength = value;
    return this;
  }

  // Cross-file dependency metrics

  circularDependencyCount(value: number | undefined): this {
    if (value !== undefined) this.metadata.circularDependencyCount = value;
    return this;
  }

  instability(value: number | undefined): this {
    if (value !== undefined) this.metadata.instability = value;
    return this;
  }

  /**
   * Build the final NodeMetadata object
   */
  build(): NodeMetadata {
    return { ...this.metadata };
  }
}

/**
 * Convenience function for creating default metadata
 */
export function createDefaultMetadata(): NodeMetadata {
  return NodeMetadataBuilder.defaults();
}

/**
 * Convenience function for creating metadata from a symbol
 */
export function createMetadataFromSymbol(symbol: LightweightSymbol): NodeMetadata {
  return NodeMetadataBuilder.fromSymbol(symbol).build();
}
