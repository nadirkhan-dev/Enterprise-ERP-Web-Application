// Component-level token overrides for PrimeVue components.
// Only override tokens that have dt() slots in PrimeVue's CSS templates.
// For properties not exposed as tokens (e.g. font-weight on InputText),
// use :deep() in the wrapper component's scoped styles with --p-* variables.
export const components = {
    button: {
        root: {
            borderRadius: '{borderRadius.xs}',
            label: {
                // Figma "Button/medium" spec is weight 600 (semibold), not 400.
                fontWeight: '{font.weight.semibold}'
            }
        },
        colorScheme: {
            light: {
                root: {
                    secondary: {
                        background: '{gray.50}',
                        color: '{deepblue.900}'
                    }
                },
                text: {
                    secondary: {
                        color: '{deepblue.900}'
                    }
                },
                outlined: {
                    primary: {
                        borderColor: '{skyblue.200}'
                    },
                    secondary: {
                        color: '{deepblue.900}'
                    }
                }
            }
        }
    },
    inputtext: {
        root: {
            borderRadius: '{borderRadius.xs}',
            borderColor: '{gray.200}',
            disabledBackground: '{gray.100}',
            paddingY: '0.59rem'
        }
    },
    checkbox: {
        root: {
            borderRadius: '{borderRadius.xs}',
            borderColor: '{gray.200}'
        }
    },
    radiobutton: {
        root: {
            borderColor: '{gray.200}'
        }
    },
    textarea: {
        root: {
            borderRadius: '{borderRadius.xs}',
            borderColor: '{gray.200}'
        }
    },
    select: {
        root: {
            borderRadius: '{borderRadius.xs}',
            borderColor: '{gray.200}',
            disabledBackground: '{gray.100}'
        },
        dropdown: {
            color: '{gray.300}'
        },
        option: {
            focusBackground: '{tideblue.50}'
        }
    },
    multiselect: {
        root: {
            borderRadius: '{borderRadius.xs}',
            borderColor: '{gray.200}',
            disabledBackground: '{gray.100}'
        },
        dropdown: {
            color: '{gray.300}'
        }
    },
    autocomplete: {
        root: {
            borderRadius: '{borderRadius.xs}',
            borderColor: '{gray.200}',
            disabledBackground: '{gray.100}',
            paddingY: '0.59rem'
        },
        chip: {
            borderRadius: '{borderRadius.xs}'
        }
    },
    drawer: {
        header: {
            padding: 'clamp(0.875rem, 1.8vw, 1.09375rem) clamp(1rem, 2.5vw, 1.5rem)'
        }
    },
    datatable: {
        root: {
            sortIcon: {
                size: 'clamp(0.5rem, 1.2vw, 0.6875rem)'
            },
            header: {
                cell: {
                    background: '{surface.0}',
                    color: '{deepblue.900}',
                    hoverBackground: '{tideblue.50}',
                    hoverColor: '{deepblue.900}',
                    borderColor: '{surface.200}',
                    padding:
                        'clamp(0.125rem, 1.2vw - 0.4rem, 0.65625rem) clamp(0.5rem, 0.9vw + 0.3rem, 0.875rem)',
                    selectedBackground: '{surface.0}',
                    selectedColor: '{deepblue.900}'
                }
            },
            column: {
                title: {
                    fontWeight: '{font.weight.medium}'
                }
            },
            row: {
                background: '{surface.0}',
                color: '{gray.800}',
                hoverBackground: '{surface.50}'
            },
            body: {
                cell: {
                    borderColor: '{surface.200}',
                    padding:
                        'clamp(0.125rem, 1.2vw - 0.4rem, 0.65625rem) clamp(0.5rem, 0.9vw + 0.3rem, 0.875rem)'
                }
            },
            footer: {
                borderWidth: '0'
            }
        }
    },
    toast: {
        root: {
            width: '21.875rem',
            borderRadius: '{borderRadius.xs}',
            borderWidth: '1px'
        },
        icon: {size: '0.984rem'},
        content: {padding: '1rem', gap: '0.438rem'},
        text: {gap: '0.438rem'},
        summary: {
            font: {weight: '{font.weight.medium}', size: '{font.size.sm}'}
        },
        detail: {
            font: {weight: '{font.weight.medium}', size: '{font.size.xs}'}
        },
        close: {
            button: {
                width: '1.531rem',
                height: '1.531rem',
                borderRadius: '50%'
            },
            icon: {size: '{font.size.sm}'}
        },
        colorScheme: {
            light: {
                root: {blur: '0.75px'},
                success: {
                    background: '{vividgreen.50}',
                    borderColor: '{vividgreen.200}',
                    color: '{vividgreen.500}',
                    detailColor: '{gray.800}',
                    shadow: '0px 4px 8px 0px rgba(1, 8, 4, 0.04)'
                },
                info: {
                    background: '{skyblue.50}',
                    borderColor: '{skyblue.200}',
                    color: '{skyblue.600}',
                    detailColor: '{gray.800}',
                    shadow: '0px 4px 8px 0px rgba(1, 8, 4, 0.04)'
                },
                warn: {
                    background: '{orange.50}',
                    borderColor: '{orange.200}',
                    color: '{orange.700}',
                    detailColor: '{gray.800}',
                    shadow: '0px 4px 8px 0px rgba(9, 7, 0, 0.04)'
                },
                error: {
                    background: '{red.50}',
                    borderColor: '{red.200}',
                    color: '{red.700}',
                    detailColor: '{gray.800}',
                    shadow: '0px 4px 8px 0px rgba(10, 3, 3, 0.04)'
                },
                secondary: {
                    background: '{deepblue.50}',
                    borderColor: '{deepblue.200}',
                    color: '{deepblue.900}',
                    detailColor: '{gray.800}',
                    shadow: '0px 4px 8px 0px rgba(4, 5, 6, 0.04)'
                },
                contrast: {
                    background: '{neutral.1000}',
                    borderColor: '{gray.900}',
                    color: '{neutral.0}',
                    detailColor: '{neutral.0}',
                    shadow: '0px 4px 8px 0px rgba(0, 0, 1, 0.04)'
                }
            }
        }
    },
    message: {
        root: {
            borderRadius: '{borderRadius.none}'
        }
    },
    tag: {
        root: {
            borderRadius: '{borderRadius.xs}',
            fontSize: '{font.size.xs}',
            fontWeight: '{font.weight.medium}'
        },
        colorScheme: {
            light: {
                secondary: {
                    background: '{gray.50}',
                    color: '{deepblue.900}'
                }
            }
        }
    },
    tooltip: {
        root: {
            background: '{primary.50}',
            color: '{deepblue.900}',
            borderRadius: '{borderRadius.md}',
            padding: '{spacing.2} {spacing.3}',
            shadow: '{shadow.md}',
            maxWidth: '200px',
            gutter: '{spacing.1}'
        }
    },
    badge: {
        root: {
            height: '{spacing.4.375}',
            minWidth: '{spacing.4.375}',
            fontSize: '{font.size.xxs}',
            fontWeight: '{font.weight.normal}'
        }
    }
};
