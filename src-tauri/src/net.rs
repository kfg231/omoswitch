//! Provider network operations are implemented in a later Phase 2 task.

use std::time::Duration;

pub fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(8)))
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .new_agent()
}
