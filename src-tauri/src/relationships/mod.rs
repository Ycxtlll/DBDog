//! Logical foreign key relationships: DBDog builds the link graph modern
//! schemas no longer declare physically. See docs/plan-grid-depth.md (M2).

pub mod infer;
pub mod model;
pub mod parse;
pub mod store;
