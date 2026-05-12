# EagleView Patent Landscape Analysis

## Executive Summary

EagleView Technologies and its affiliate Pictometry International Corp hold a substantial patent portfolio covering aerial roof measurement technology. With over **300 domestic and international patents**, EagleView has aggressively defended its intellectual property, securing over **$375 million in damages** against competitors (Xactware/Verisk). This document catalogs key patents relevant to aerial roof measurement, report generation, and geometry extraction.

**Key Risk Areas for Alternative Implementations:**
1. Using aerial imagery to measure roof dimensions remotely
2. Automated pitch determination from oblique aerial photos
3. 3D model reconstruction from multiple aerial viewpoints
4. Automated roof segmentation and boundary detection
5. Report generation with linear features and area calculations
6. Drone-based property inspection workflows

---

## Core Patent Portfolio

### 1. System and Process for Roof Measurement Using Aerial Imagery

| Patent | US8515125B2 |
|--------|-------------|
| **Filed** | January 25, 2013 |
| **Issued** | August 20, 2013 |
| **Assignee** | Pictometry International Corp |
| **Inventors** | Dale R. Thornberry, Chris T. Thornberry, Mark F. Garringer |

**Key Claims:**
- Creating layered electronic drawings over aerial imagery representing distinct roof planes
- Layer-based attribution where overlapping line segments have different attributes (perimeter, step flashing, etc.)
- Pitch vector calculation using rules based on ridge lines and perimeter orientation
- Triangle dissection method for area calculation using dot product vectors
- Contrast-based edge detection for automatic roof plane boundary identification
- Interactive adjustment allowing users to override calculated dimensions

**Risk Assessment:** HIGH - This patent covers fundamental techniques for extracting roof geometry from aerial imagery.

---

### 2. System and Process for Roof Measurement Using Aerial Imagery (Continuation)

| Patent | US9329749B2 |
|--------|-------------|
| **Filed** | March 6, 2013 |
| **Issued** | May 3, 2016 |
| **Assignee** | Pictometry International Corp |
| **Inventors** | Dale R. Thornberry, Chris T. Thornberry, Mark F. Garringer |

**Key Claims:**
- Location input processing with moveable marker positioning over target building
- Address translation to precise latitude/longitude coordinates
- Access to higher-resolution imagery for detailed measurement
- Interactive override of pitch angles, line lengths, and areas
- "Substantially overlapping lines" with different non-dimensional attributes

**Risk Assessment:** HIGH - Covers user interaction patterns for roof measurement workflows.

---

### 3. Aerial Roof Estimation System and Method

| Patent | US8145578B2 |
|--------|-------------|
| **Filed** | April 17, 2008 |
| **Issued** | March 27, 2012 |
| **Assignee** | EagleView Technologies Inc |
| **Inventors** | Chris Pershing, Dave Carlson |

**Key Claims:**
- Aerial image database integration for remote measurement without site visits
- Image analysis and calibration module for determining geometry, slopes, and pitch angles
- 3D reconstruction using photogrammetric algorithms with triangulated reference points
- Automated report generation with square footage, pitch, ridges, and valleys
- Multi-entity service models (contractors, third-party services, referral networks)

**Risk Assessment:** HIGH - Foundational patent for remote aerial roof estimation services.

---

### 4. Aerial Roof Estimation System and Method (Continuation)

| Patent | US10528960B2 |
|--------|-------------|
| **Filed** | February 10, 2012 |
| **Issued** | January 7, 2020 |
| **Assignee** | EagleView Technologies Inc |
| **Inventors** | Chris Pershing, Dave P. Carlson |

**Key Claims:**
- Photogrammetric reconstruction using photographs from multiple viewpoints
- Calibration to convert pixel distances to physical measurements
- Reference point identification across multiple aerial images
- Multi-view analysis (flat roofs require one image; pitched roofs require two or more)
- 3D model extraction for total square footage, pitch angles, and ridge/valley identification

**Risk Assessment:** HIGH - Covers photogrammetric techniques central to 3D roof reconstruction.

---

### 5. Pitch Determination Systems and Methods for Aerial Roof Estimation

| Patent | US8818770B2 |
|--------|-------------|
| **Filed** | April 3, 2012 |
| **Issued** | August 26, 2014 |
| **Assignee** | EagleView Technologies Inc |

**Key Claims:**
- Protractor tool method with adjustable arms aligned to sloped roof edges
- Envelope tool method with dual-surface marker for adjacent roof sections
- Automatic pitch determination based on geometric information and symmetry assumptions
- Concurrent display across multiple aerial image views for real-time feedback
- Pitch measurement in inches per 12 inches horizontal run

**Risk Assessment:** MEDIUM - Specific to interactive pitch determination tools.

---

### 6. Aerial Roof Estimation Systems and Methods

| Patent | US9514568B2 |
|--------|-------------|
| **Filed** | March 3, 2014 |
| **Issued** | December 6, 2016 |
| **Assignee** | EagleView Technologies Inc |
| **Inventors** | Chris Pershing, David P. Carlson |

**Key Claims:**
- Image acquisition from aircraft, balloons, or satellites
- Calibration module converting pixel distances to physical measurements
- 3D modeling using triangulation algorithms
- Automated analysis for dimensions, pitch angles, and surface areas
- Report generation with annotated diagrams

**Risk Assessment:** HIGH - Broad coverage of aerial roof estimation workflows.

---

### 7. Automated Roof Identification Systems and Methods

| Patent | US8731234B1 |
|--------|-------------|
| **Filed** | November 2, 2009 |
| **Issued** | May 20, 2014 |
| **Assignee** | EagleView Technologies Inc |

**Key Claims:**
- Statistical analysis computing measures for image sections input to AI systems
- Training using historical images with known roof areas
- AI-driven detection using neural networks and Bayesian models
- Watershed and Edison-style segmentation for roof boundary determination
- Probabilistic roof likelihood mapping

**Risk Assessment:** MEDIUM-HIGH - Covers AI/ML-based roof detection techniques.

---

### 8. Concurrent Display Systems and Methods for Aerial Roof Estimation

| Patent | US8209152B2 |
|--------|-------------|
| **Filed** | N/A |
| **Issued** | June 26, 2012 |
| **Assignee** | EagleView Technologies Inc |

**Key Claims:**
- Concurrent display of roof models across multiple aerial image views
- Real-time operator feedback during model construction

**Risk Assessment:** MEDIUM - UI/UX specific to multi-view display.

---

### 9. Unmanned Aircraft Structure Evaluation System and Method

| Patent | US9612598 |
|--------|-------------|
| **Filed** | N/A |
| **Issued** | April 4, 2017 |
| **Assignee** | EagleView Technologies Inc |

**Key Claims:**
- Automatic flight path generation around structures based on camera characteristics
- Path definition using known outline and height of structure
- Drone imagery capture for property inspection

**Risk Assessment:** MEDIUM - Specific to drone-based inspection workflows.

---

## Additional Patents (Continuation Chain)

| Patent Number | Title | Issued |
|---------------|-------|--------|
| US8542880B2 | System and process for roof measurement using aerial imagery | 2013 |
| US9070018B1 | Automated roof identification systems and methods | 2015 |
| US20100179787A2 | Aerial roof estimation system and method | Application |
| US20100296693A1 | System and process for roof measurement using aerial imagery | Application |
| US20130212536A1 | System and process for roof measurement using aerial imagery | Application |

---

## Patent Litigation History

### EagleView v. Xactware/Verisk (2015-2021)

**Case:** United States District Court for the District of New Jersey

**Alleged Infringing Products:**
- Xactimate
- Roof InSight
- Property InSight
- Aerial Sketch

**Outcome:**
- **$125 million** awarded (September 2019) for willful infringement of 5 patents
- **$250 million** additional damages (February 2021)
- **Total: $375 million** in damages

**PTAB Challenges:** Of 153 claims challenged by defendants, **142 were confirmed as valid** (not invalid).

### Other Litigation

EagleView has pursued similar patent infringement litigation against:
- Roofr
- GAF
- NearMap

---

## Safe Implementation Strategies

Based on patent analysis, the following approaches may reduce infringement risk:

### 1. Use Alternative Data Sources
- **Google Solar API** - Provides pre-computed roof data, not raw aerial processing
- **Microsoft/Esri Building Footprints** - Derived from different methodology
- **LiDAR point clouds** - Different sensing modality than aerial photography
- **Property records and permits** - Non-imagery sources for building data

### 2. Avoid Patented Workflows
- Do NOT implement interactive pitch determination with protractor/envelope tools
- Do NOT use multi-image photogrammetric triangulation for 3D reconstruction
- Do NOT implement layer-based attribution for overlapping line segments
- Do NOT use contrast-based edge detection for roof plane boundaries

### 3. Use Different Algorithmic Approaches
- **Straight skeleton algorithm** - Mathematical approach vs. image-based detection
- **DSM/DTM analysis** - Elevation data vs. photogrammetric reconstruction
- **Pre-trained building segmentation models** - May not involve patented training methods
- **Vector footprint extraction** - Use existing building polygon databases

### 4. Vendor Report Parsing (Not Covered by Patents)
- Parsing existing roof reports (EagleView, HoverMap, etc.) is NOT patented
- Extracting data from vendor-provided PDFs is transformative use
- Converting vendor geometry to internal formats is acceptable

### 5. User-Supplied Measurements
- Allow users to input measurements manually
- Users can draw roof outlines on satellite imagery
- User-driven measurement is distinct from automated extraction

---

## Recommended Technical Architecture

```
+------------------+      +-------------------+      +------------------+
|  Property Input  | ---> | Footprint Sources | ---> | Geometry Engine  |
|  (Address/GPS)   |      | - Google Solar    |      | - Straight       |
+------------------+      | - Microsoft Esri  |      |   Skeleton       |
                          | - Mapbox Vector   |      | - Facet Split    |
                          | - OSM Buildings   |      | - Area Calc      |
                          +-------------------+      +------------------+
                                                            |
                                                            v
+------------------+      +-------------------+      +------------------+
| Report Output    | <--- | QA Validation     | <--- | Topology         |
| - PDF Generation |      | - Area bounds     |      | Analysis         |
| - Smart Tags     |      | - Shape checks    |      | - Ridge/Valley   |
+------------------+      | - Manual review   |      | - Edge classify  |
                          +-------------------+      +------------------+
```

**Key Differentiators:**
1. No photogrammetric 3D reconstruction from aerial images
2. No automated pitch detection from oblique imagery
3. Use of existing pre-computed building data (Google Solar, Microsoft, etc.)
4. Mathematical geometry algorithms (straight skeleton) vs. image processing
5. Vendor report parsing for professional measurements

---

## Conclusion

EagleView's patent portfolio presents significant IP risk for any system that:
1. Processes raw aerial imagery to extract roof measurements
2. Uses multiple aerial views for 3D reconstruction
3. Implements interactive pitch determination tools
4. Generates reports with automated linear feature extraction

**Safe Alternatives:**
- Leverage pre-computed data from Google Solar API, Microsoft Buildings, etc.
- Use mathematical algorithms (straight skeleton) on existing footprints
- Parse vendor reports rather than recreating their measurement process
- Allow user-driven measurement input

---

## Sources

- [US8515125B2 - Google Patents](https://patents.google.com/patent/US8515125)
- [US9329749B2 - Google Patents](https://patents.google.com/patent/US9329749B2/en)
- [US8145578B2 - Google Patents](https://patents.google.com/patent/US8145578B2/en)
- [US10528960B2 - Google Patents](https://patents.google.com/patent/US10528960B2/en)
- [US8818770B2 - Google Patents](https://patents.google.com/patent/US8818770B2/en)
- [US9514568B2 - Google Patents](https://patents.google.com/patent/US9514568B2/en)
- [US8731234B1 - Google Patents](https://patents.google.com/patent/US8731234)
- [EagleView Patent Litigation Timeline](https://www.eagleview.com/insurance/eagleview-xactware-verisk-litigation-timeline/)
- [EagleView $375M Award](https://www.randrmagonline.com/articles/89375-eagleview-awarded-375m-in-lawsuit-against-verisk-analytics-parent-company-to-xactware)
- [EagleView Drone Patent](https://www.eagleview.com/insurance/eagleview-patent-drone-property-inspection/)

---

*Document generated: May 12, 2026*
*For internal use only - consult legal counsel before implementation decisions*
