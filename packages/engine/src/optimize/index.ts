/**
 * Server-only entry point: the optimizer loads the HiGHS WebAssembly solver,
 * which has no business in a browser bundle. Import from '@gc/engine/optimize'.
 */
export { planBasket, type PlanInput, type PlanOptions } from './plan';
export { buildProblem, evaluate, toPlan, type PlatformSpec, type Problem, type Solution } from './problem';
export { solveExact, buildLp } from './solver';
export { bruteForce } from './brute';
export { explainLine } from './explain';
