# Configuration Management Policy

## 1. Purpose

This policy establishes configuration management requirements for information systems operated by **{{org.legal_name}}** in accordance with NIST SP 800-171 Rev 2 (Family 3.4) and CMMC {{si.target_cmmc_level}} requirements.

## 2. Scope

This policy applies to all information systems, software, and hardware within the {{si.boundary_strategy}} boundary, including {{si.deployment_posture}} environments.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| ISSO | {{personnel.isso.name}} | Approve security configuration baselines |
| IT Director | {{personnel.it_director.name}} | Maintain configuration standards and manage changes |
| System Owner | {{personnel.system_owner.name}} | Authorize configuration changes |
| Change Control Owner | {{si.change_control_owner}} | Review and approve change requests |

## 4. Policy Statements

### 4.1 Baseline Configurations (3.4.1, 3.4.2)

- Baseline configurations shall be established, documented, and maintained for all information systems
- Configurations shall reflect the most restrictive mode consistent with operational requirements
- Baselines shall include operating system settings, application configurations, and network device configurations

### 4.2 Configuration Change Control (3.4.3, 3.4.4, 3.4.5)

- All changes to information systems shall be tracked, reviewed, and approved prior to implementation
- Security impact analyses shall be conducted for proposed changes
- Physical and logical access restrictions shall limit who can make changes to systems
- Changes to the CUI boundary or security configurations require documented approval from the System Owner

### 4.3 Least Functionality (3.4.6, 3.4.7, 3.4.8)

- Systems shall be configured to provide only essential capabilities
- Unnecessary functions, ports, protocols, and services shall be disabled
- Software installation shall be restricted to authorized personnel
- Application whitelisting or similar controls shall be implemented where feasible

### 4.4 Nonessential Programs (3.4.8)

Policies shall be defined for restricting the use of:
- Unauthorized software applications
- Non-essential system utilities
- Peer-to-peer applications
- Unauthorized browser extensions

### 4.5 User-Installed Software (3.4.9)

- Users shall not install software on organizational systems without prior authorization
- Software requests shall be submitted through the change management process
- An approved software list shall be maintained and reviewed periodically

## 5. Configuration Documentation

All configuration baselines and changes shall be documented and retained for audit purposes.

## 6. Review

This policy shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.4.1–3.4.9
**Policy Owner:** {{personnel.isso.name}}
