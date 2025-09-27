# PITCH CRM Missing Features Implementation Plan

Based on the comprehensive blueprint analysis, here are the missing/incomplete features that need immediate implementation:

## 🚨 CRITICAL MISSING FEATURES

### 1. **Contact-Lead-Job Numbering System (C-L-J Format)**
- **Status**: PARTIALLY IMPLEMENTED
- **Missing**: Proper C-L-J sequence formatting (e.g., "1-2-0" = Contact 1, Lead 2, No Job yet)
- **Current**: Individual numbering exists but not linked sequentially
- **Action**: Implement sequence triplet system with proper formatting

### 2. **Manager Approval Gate for Lead → Project Conversion**
- **Status**: NOT IMPLEMENTED
- **Missing**: Hard gate preventing direct Lead → Project movement without manager approval
- **Current**: Direct pipeline movement allowed
- **Action**: Add "On Hold (Mgr Review)" column and RPC approval system

### 3. **Customer Portal with Payments**
- **Status**: NOT IMPLEMENTED
- **Missing**: Customer-facing portal showing status, documents, and Stripe Payment Links
- **Current**: Internal-only interface
- **Action**: Build customer portal with payment integration

### 4. **Address Validation Integration**
- **Status**: PARTIALLY IMPLEMENTED  
- **Missing**: Google Address Validation API + Places Autocomplete
- **Current**: Basic address input fields
- **Action**: Integrate Google APIs for address validation

### 5. **Stripe Payment Links Integration**
- **Status**: NOT IMPLEMENTED
- **Missing**: Automated Stripe Payment Link creation and management
- **Current**: No payment processing
- **Action**: Implement Stripe Payment Links API

### 6. **Unified Communications Timeline**
- **Status**: NOT IMPLEMENTED
- **Missing**: Single timeline for iMessage, SMS, Email, Voice calls
- **Current**: Scattered communication components
- **Action**: Build unified communication hub with webhook processing

### 7. **Weather Integration for Scheduling**
- **Status**: NOT IMPLEMENTED
- **Missing**: OpenWeather API integration to pause production during bad weather
- **Current**: No weather-based scheduling
- **Action**: Implement weather overlay and auto-pause functionality

## 🔧 PARTIALLY IMPLEMENTED FEATURES

### 8. **Production Stages with NOC/Permit Gates**
- **Status**: PARTIALLY IMPLEMENTED
- **Completed**: Basic production workflow, NOC/permit checkboxes
- **Missing**: Hard enforcement of gates, document upload requirements
- **Action**: Enforce gate requirements and document validation

### 9. **GPS-Stamped Photo Evidence**
- **Status**: PARTIALLY IMPLEMENTED
- **Completed**: GPS tracking in photo component
- **Missing**: EXIF enforcement, manual geocoding fallback
- **Action**: Enforce GPS requirements with fallback options

### 10. **Estimation & Pricing Engine**
- **Status**: PARTIALLY IMPLEMENTED
- **Completed**: Basic estimation forms
- **Missing**: Profit slider, version control, supplier pricing integration
- **Action**: Complete pricing engine with real-time calculations

## 📋 IMPLEMENTATION PRIORITY

### Phase 1: Core Business Logic (Weeks 1-2)
1. **Manager Approval Gate System**
   - Add "On Hold (Mgr Review)" pipeline column
   - Create `api_approve_job_from_lead` RPC
   - Implement role-based restrictions

2. **C-L-J Numbering System**
   - Update database functions for sequence triplets
   - Modify display components to show proper formatting
   - Update search functionality

### Phase 2: Customer Experience (Weeks 3-4)
3. **Customer Portal**
   - Build customer-facing dashboard
   - Project status visibility
   - Document access

4. **Stripe Payment Links**
   - Integration setup
   - Payment link generation
   - Webhook processing

### Phase 3: Integrations (Weeks 5-6)
5. **Address Validation**
   - Google Places Autocomplete
   - Address Validation API
   - Structured address storage

6. **Weather Integration**
   - OpenWeather API setup
   - Scheduling logic
   - Auto-pause functionality

### Phase 4: Communications (Weeks 7-8)
7. **Unified Communications**
   - Timeline component
   - Webhook processors
   - Multi-channel integration

8. **Enhanced Photo Management**
   - EXIF enforcement
   - GPS validation
   - Manual geocoding

## 🛠️ IMMEDIATE ACTION ITEMS

### Database Changes Needed:
1. Add sequence triplet columns to contacts/leads/jobs tables
2. Add manager approval workflow tables
3. Add customer portal access tables
4. Add payment links tracking tables
5. Add weather integration settings

### New Components to Create:
1. `ManagerApprovalGate` component
2. `CustomerPortal` application
3. `PaymentLinksManager` component
4. `AddressValidation` form component
5. `WeatherOverlay` component
6. `CommunicationsTimeline` component

### API Integrations Required:
1. Google Places/Address Validation APIs
2. Stripe Payment Links API
3. OpenWeather One Call API
4. iMessage/SMS/Email webhook processors

### Security & RLS Updates:
1. Customer portal RLS policies
2. Payment access restrictions
3. Manager approval permissions
4. Communication privacy controls

## 📊 COMPLETION METRICS

- **Current Implementation**: ~65% of blueprint features
- **Target Implementation**: 95% of blueprint features
- **Estimated Timeline**: 8-10 weeks for full implementation
- **Critical Path**: Manager approval gate → Customer portal → Payment integration

## 🎯 SUCCESS CRITERIA

1. **Manager can approve/reject lead→project conversions**
2. **Customers can view project status and make payments**
3. **All addresses are validated and structured**
4. **Production automatically pauses during bad weather**
5. **All communications appear in unified timeline**
6. **C-L-J numbering system provides clear traceability**

## 📋 NEXT STEPS

1. **Review and approve this implementation plan**
2. **Set up required API keys and integrations**
3. **Begin Phase 1 development (Manager Approval Gate)**
4. **Create database migrations for new tables**
5. **Establish testing procedures for each feature**

---

*This plan aligns with the PITCH Roofing CRM Blueprint v1.0 and focuses on completing the most critical missing features for a production-ready system.*