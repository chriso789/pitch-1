

# Remove Recalculate + Create New Estimate buttons from editing mode

## Change
Delete the entire block at lines 2267-2310 that shows "Viewing saved estimate" with the Recalculate and Create New Estimate buttons. This block only renders during edit mode (`isEditingLoadedEstimate && selectedTemplateId`) and is not needed — the system handles recalculation automatically as items change, and the Save Estimate button handles persistence.

